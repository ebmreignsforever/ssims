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

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

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
        throw error;
      }
    }
    logger.info('Database migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  logger.error({ err: error }, 'Migration failed');
  process.exit(1);
});
