const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

  try {
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
    client.release();
  }
}

module.exports = {
  runMigrations,
};
