const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_ADVISORY_LOCK_ID = 847291038472;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function getMigrationFiles(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function runMigrations({ pool, migrationsDir, logger = console }) {
  const resolvedDir = migrationsDir || path.join(__dirname, '../../migrations');
  const files = getMigrationFiles(resolvedDir);
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // Acquire distributed advisory lock to prevent race conditions during multi-instance autoscaling
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATIONS_ADVISORY_LOCK_ID]);
      lockAcquired = true;
    } catch (err) {
      // In-memory mock databases (e.g. pg-mem) do not support pg_advisory_lock
      logger.debug?.({ err: err.message }, 'Advisory lock skipped or unsupported by database');
    }

    await ensureMigrationsTable(client);

    const appliedRows = await client.query('SELECT name, checksum FROM schema_migrations');
    const appliedMap = new Map(appliedRows.rows.map((row) => [row.name, row.checksum]));

    for (const file of files) {
      const absolutePath = path.join(resolvedDir, file);
      const sql = fs.readFileSync(absolutePath, 'utf8');
      const checksum = sha256(sql);

      if (appliedMap.has(file)) {
        const appliedChecksum = appliedMap.get(file);
        if (appliedChecksum !== checksum) {
          if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_MIGRATION_UPDATE === 'true') {
            await client.query('UPDATE schema_migrations SET checksum = $1, applied_at = NOW() WHERE name = $2', [checksum, file]);
            continue;
          }
          throw new Error(`Migration checksum mismatch for ${file}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
        logger.info({ migration: file }, 'Applied migration');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATIONS_ADVISORY_LOCK_ID]);
      } catch (err) {
        logger.warn?.({ err: err.message }, 'Failed to release pg_advisory_unlock');
      }
    }
    client.release();
  }
}

module.exports = {
  runMigrations,
};
