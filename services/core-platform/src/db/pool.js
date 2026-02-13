const { Pool } = require('pg');
const config = require('../config');

let pool;

function createPool() {
  if (process.env.CORE_USE_PGMEM === 'true') {
    const { newDb } = require('pg-mem');
    const db = newDb();
    const adapter = db.adapters.createPg();
    return new adapter.Pool();
  }

  return new Pool({
    connectionString: config.databaseUrl,
  });
}

function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

module.exports = {
  getPool,
  query,
  closePool,
};
