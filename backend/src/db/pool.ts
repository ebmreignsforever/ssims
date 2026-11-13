import fs from 'node:fs';
import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

function buildSslConfig() {
  if (config.dbSslMode === 'disable') return false;

  if (config.dbSslMode === 'require') {
    // Encryption without certificate verification is vulnerable to MITM and is
    // only offered for compatibility. Production validation forbids it.
    return { rejectUnauthorized: false };
  }

  if (!config.dbSslCa) {
    throw new Error('DB_SSL_CA is required when DB_SSL_MODE=verify-full');
  }

  // verify-full: validate the database certificate chain and hostname. This is
  // the configuration used by Docker Compose with the project-local CA.
  return {
    ca: fs.readFileSync(config.dbSslCa, 'utf8'),
    rejectUnauthorized: true,
    servername: config.dbSslServerName,
  };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  application_name: 'ssims-api',
  ssl: buildSslConfig(),
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected PostgreSQL pool error');
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a callback inside a transaction. Every query in the callback uses
 * parameter placeholders; no user value is ever interpolated into SQL text.
 */
export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyDatabaseConnection(): Promise<void> {
  const result = await pool.query<{ version: string; ssl: boolean }>(
    "SELECT version(), (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl",
  );
  const row = result.rows[0];
  logger.info(
    { databaseVersion: row?.version.split(',')[0], databaseTls: row?.ssl },
    'PostgreSQL connection established',
  );
  if (config.isProduction && !row?.ssl) {
    throw new Error('Refusing to run in production without an encrypted database connection');
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
