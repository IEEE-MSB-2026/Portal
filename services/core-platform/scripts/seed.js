const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrations');
const logger = require('../src/utils/logger');

async function seed() {
  const pool = getPool();
  const migrationsDir = path.join(__dirname, '../migrations');

  try {
    logger.info('Applying all migrations before seeding...');
    await runMigrations({ pool, migrationsDir, logger });

    logger.info('Executing initial seed data migration...');
    const seedSqlPath = path.join(migrationsDir, '002_seed_initial_data.sql');
    const seedSql = fs.readFileSync(seedSqlPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(seedSql);
      await client.query('COMMIT');
      logger.info('Development database seeded successfully!');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
