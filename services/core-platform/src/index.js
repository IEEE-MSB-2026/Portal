const { Client } = require('pg');
const { URL } = require('url');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getPool, closePool } = require('./db/pool');
const { runMigrations } = require('./db/migrations');

async function initDatabase() {
  try {
    logger.info('Running database migrations...');
    await runMigrations({ pool: getPool(), logger });
    logger.info('Database migrations applied successfully.');
  } catch (err) {
    logger.error({ err: err.message }, 'Database initialization / migration error');
    throw err;
  }
}

const { startCampaignScheduler, stopCampaignScheduler } = require('./schedulers/campaignScheduler');

async function start() {
  let server;
  try {
    await initDatabase();
    server = app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Core platform service listening');
      startCampaignScheduler();
    });

    // Graceful shutdown handler
    const handleShutdown = async (signal) => {
      logger.info({ signal }, 'Shutting down core-platform gracefully...');
      stopCampaignScheduler();
      if (server) {
        await new Promise((resolve) => server.close(resolve));
        logger.info('HTTP server closed.');
      }
      await closePool();
      logger.info('Database pool drained and closed.');
      process.exit(0);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (err) {
    logger.fatal({ err: err.message }, 'Failed to start core-platform service');
    process.exit(1);
  }
}

start();
