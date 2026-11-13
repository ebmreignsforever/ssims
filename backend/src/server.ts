import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closePool, verifyDatabaseConnection } from './db/pool';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  await verifyDatabaseConnection();
  const app = createApp();
  const server = http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(
      { port: config.port, environment: config.nodeEnv, securityHeaders: true },
      'SSIMS API listening',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down SSIMS API');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start SSIMS API');
  process.exit(1);
});
