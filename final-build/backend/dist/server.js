"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const app_1 = require("./app");
const config_1 = require("./config");
const pool_1 = require("./db/pool");
const logger_1 = require("./utils/logger");
async function main() {
    await (0, pool_1.verifyDatabaseConnection)();
    const app = (0, app_1.createApp)();
    const server = node_http_1.default.createServer(app);
    server.listen(config_1.config.port, '0.0.0.0', () => {
        logger_1.logger.info({ port: config_1.config.port, environment: config_1.config.nodeEnv, securityHeaders: true }, 'SSIMS API listening');
    });
    const shutdown = (signal) => {
        logger_1.logger.info({ signal }, 'Shutting down SSIMS API');
        server.close(async () => {
            await (0, pool_1.closePool)();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
        logger_1.logger.error({ err: reason }, 'Unhandled promise rejection');
    });
    process.on('uncaughtException', (error) => {
        logger_1.logger.fatal({ err: error }, 'Uncaught exception');
        shutdown('uncaughtException');
    });
}
main().catch((error) => {
    logger_1.logger.fatal({ err: error }, 'Failed to start SSIMS API');
    process.exit(1);
});
//# sourceMappingURL=server.js.map