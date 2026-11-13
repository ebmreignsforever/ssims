"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.queryOne = queryOne;
exports.withTransaction = withTransaction;
exports.verifyDatabaseConnection = verifyDatabaseConnection;
exports.closePool = closePool;
const node_fs_1 = __importDefault(require("node:fs"));
const pg_1 = require("pg");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
function buildSslConfig() {
    if (config_1.config.dbSslMode === 'disable')
        return false;
    if (config_1.config.dbSslMode === 'require') {
        // Encryption without certificate verification is vulnerable to MITM and is
        // only offered for compatibility. Production validation forbids it.
        return { rejectUnauthorized: false };
    }
    if (!config_1.config.dbSslCa) {
        throw new Error('DB_SSL_CA is required when DB_SSL_MODE=verify-full');
    }
    // verify-full: validate the database certificate chain and hostname. This is
    // the configuration used by Docker Compose with the project-local CA.
    return {
        ca: node_fs_1.default.readFileSync(config_1.config.dbSslCa, 'utf8'),
        rejectUnauthorized: true,
        servername: config_1.config.dbSslServerName,
    };
}
exports.pool = new pg_1.Pool({
    connectionString: config_1.config.databaseUrl,
    max: config_1.config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: 'ssims-api',
    ssl: buildSslConfig(),
});
exports.pool.on('error', (error) => {
    logger_1.logger.error({ err: error }, 'Unexpected PostgreSQL pool error');
});
async function query(text, params = []) {
    const result = await exports.pool.query(text, params);
    return result.rows;
}
async function queryOne(text, params = []) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
/**
 * Run a callback inside a transaction. Every query in the callback uses
 * parameter placeholders; no user value is ever interpolated into SQL text.
 */
async function withTransaction(callback) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function verifyDatabaseConnection() {
    const result = await exports.pool.query("SELECT version(), (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl");
    const row = result.rows[0];
    logger_1.logger.info({ databaseVersion: row?.version.split(',')[0], databaseTls: row?.ssl }, 'PostgreSQL connection established');
    if (config_1.config.isProduction && !row?.ssl) {
        throw new Error('Refusing to run in production without an encrypted database connection');
    }
}
async function closePool() {
    await exports.pool.end();
}
//# sourceMappingURL=pool.js.map