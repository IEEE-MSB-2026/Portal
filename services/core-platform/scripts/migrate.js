const path = require('path');
const { getPool, closePool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrations');
const logger = require('../src/utils/logger');

async function main() {
  const pool = getPool();
  const migrationsDir = path.join(__dirname, '../migrations');
  await runMigrations({ pool, migrationsDir, logger });
  logger.info('Migrations complete');
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Migration failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
