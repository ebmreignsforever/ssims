"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pg_1 = require("pg");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
/**
 * Simple, ordered migration runner. Migrations execute inside a transaction and
 * are recorded in schema_migrations. The migrator connects with the schema-owner
 * URL; the long-running API uses the restricted ssims_app role.
 */
async function migrate() {
    const url = config_1.config.databaseAdminUrl || config_1.config.databaseUrl;
    const pool = new pg_1.Pool({
        connectionString: url,
        ssl: config_1.config.dbSslMode === 'disable'
            ? false
            : {
                ca: config_1.config.dbSslCa ? node_fs_1.default.readFileSync(config_1.config.dbSslCa, 'utf8') : undefined,
                rejectUnauthorized: config_1.config.dbSslMode === 'verify-full',
                servername: config_1.config.dbSslServerName,
            },
    });
    const candidateDirs = [
        process.env.MIGRATIONS_DIR,
        node_path_1.default.resolve(process.cwd(), '..', 'database', 'migrations'),
        node_path_1.default.resolve(process.cwd(), 'database', 'migrations'),
        node_path_1.default.resolve(__dirname, '..', '..', '..', 'database', 'migrations'),
    ].filter(Boolean);
    const migrationsDir = candidateDirs.find((dir) => node_fs_1.default.existsSync(dir));
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
        const files = node_fs_1.default
            .readdirSync(migrationsDir)
            .filter((file) => file.endsWith('.sql'))
            .sort();
        for (const file of files) {
            const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
            if (applied.rowCount) {
                logger_1.logger.info({ file }, 'Migration already applied');
                continue;
            }
            const sql = node_fs_1.default.readFileSync(node_path_1.default.join(migrationsDir, file), 'utf8');
            logger_1.logger.info({ file }, 'Applying migration');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
        logger_1.logger.info('Database migrations complete');
    }
    finally {
        client.release();
        await pool.end();
    }
}
migrate().catch((error) => {
    logger_1.logger.error({ err: error }, 'Migration failed');
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map