const { Client } = require('pg');
const { URL } = require('url');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getPool } = require('./db/pool');
const { runMigrations } = require('./db/migrations');

async function initDatabase() {
  try {
    const dbUrl = new URL(config.databaseUrl);
    const dbName = dbUrl.pathname.replace(/^\//, '') || 'ieee_core';

    // Connect to postgres maintenance DB to ensure target database exists
    const adminUrl = new URL(config.databaseUrl);
    adminUrl.pathname = '/postgres';

    const client = new Client({
      connectionString: adminUrl.toString(),
      connectionTimeoutMillis: 3000,
    });

    try {
      await client.connect();
      const checkRes = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (checkRes.rowCount === 0) {
        logger.info({ database: dbName }, 'Database does not exist. Creating...');
        await client.query(`CREATE DATABASE "${dbName}"`);
        logger.info({ database: dbName }, 'Database created successfully.');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Could not check/create database via maintenance connection');
    } finally {
      await client.end().catch(() => {});
    }

    // Run SQL migrations
    logger.info('Running database migrations...');
    await runMigrations({ pool: getPool(), logger });
    logger.info('Database migrations applied successfully.');
  } catch (err) {
    logger.error({ err: err.message }, 'Database initialization / migration error');
    throw err;
  }
}

async function start() {
  try {
    await initDatabase();
    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Core platform service listening');
    });
  } catch (err) {
    logger.fatal({ err: err.message }, 'Failed to start core-platform service');
    process.exit(1);
  }
}

start();
