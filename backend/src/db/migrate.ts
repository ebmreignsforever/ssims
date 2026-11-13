import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Simple, ordered migration runner. Migrations execute inside a transaction and
 * are recorded in schema_migrations. The migrator connects with the schema-owner
 * URL; the long-running API uses the restricted ssims_app role.
 */
async function migrate(): Promise<void> {
  const url = config.databaseAdminUrl || config.databaseUrl;
  const pool = new Pool({
    connectionString: url,
    ssl:
      config.dbSslMode === 'disable'
        ? false
        : {
            ca: config.dbSslCa ? fs.readFileSync(config.dbSslCa, 'utf8') : undefined,
            rejectUnauthorized: config.dbSslMode === 'verify-full',
            servername: config.dbSslServerName,
          },
  });

  const candidateDirs = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), '..', 'database', 'migrations'),
    path.resolve(process.cwd(), 'database', 'migrations'),
    path.resolve(__dirname, '..', '..', '..', 'database', 'migrations'),
  ].filter(Boolean) as string[];

  const migrationsDir = candidateDirs.find((dir) => fs.existsSync(dir));
  if (!migrationsDir) {
    throw new Error(`Migrations directory not found. Tried: ${candidateDirs.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    let skipRoleBootstrap = process.env.SKIP_ROLE_BOOTSTRAP === 'true';
    if (!skipRoleBootstrap) {
      const roleState = await client.query<{
        can_create: boolean;
        app_role: boolean;
        readonly_role: boolean;
      }>(`
        SELECT (r.rolsuper OR r.rolcreaterole) AS can_create,
               EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_app') AS app_role,
               EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_readonly') AS readonly_role
          FROM pg_roles r
         WHERE r.rolname = current_user
      `);
      const state = roleState.rows[0];
      if (state && !state.can_create && (!state.app_role || !state.readonly_role)) {
        skipRoleBootstrap = true;
        logger.warn(
          'Managed PostgreSQL user cannot CREATE ROLE; skipping 002_least_privilege_grants.sql. ' +
            'Use a managed single-role database only for hosted demos; Compose keeps separate roles.',
        );
      }
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => !(skipRoleBootstrap && file.startsWith('002_')))
      .sort();

    if (process.env.SKIP_ROLE_BOOTSTRAP === 'true') {
      logger.warn(
        'SKIP_ROLE_BOOTSTRAP=true: skipping 002_least_privilege_grants.sql. ' +
          'Use this only on a managed single-role database; the local Compose stack must keep least-privilege roles.',
      );
    }

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (applied.rowCount) {
        logger.info({ file }, 'Migration already applied');
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info({ file }, 'Applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const dbError = error as { message?: string; code?: string; detail?: string; hint?: string };
        console.error(`Migration failed in ${file}: ${dbError.message || String(error)}`);
        if (dbError.code) console.error(`PostgreSQL code: ${dbError.code}`);
        if (dbError.detail) console.error(`Detail: ${dbError.detail}`);
        if (dbError.hint) console.error(`Hint: ${dbError.hint}`);
        throw error;
      }
    }
    logger.info('Database migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  const dbError = error as { message?: string; code?: string; detail?: string; hint?: string };
  // The platform log viewer may render only the message string and drop pino
  // fields. Print the actionable PostgreSQL error explicitly before exiting.
  console.error(`Migration failed: ${dbError.message || String(error)}`);
  if (dbError.code) console.error(`PostgreSQL code: ${dbError.code}`);
  if (dbError.detail) console.error(`Detail: ${dbError.detail}`);
  if (dbError.hint) console.error(`Hint: ${dbError.hint}`);
  logger.error({ err: error }, 'Migration failed');
  process.exit(1);
});
