const path = require('path');
const { getPool, closePool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrations');
const logger = require('../src/utils/logger');

async function seed() {
  const pool = getPool();
  const migrationsDir = path.join(__dirname, '../migrations');

  try {
    logger.info('Applying all migrations and seeds...');
    await runMigrations({ pool, migrationsDir, logger });
    logger.info('Database schema and seed data applied successfully!');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to seed database');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
