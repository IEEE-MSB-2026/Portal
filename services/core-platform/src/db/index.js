const { getPool, query, closePool } = require('./pool');
const { runMigrations } = require('./migrations');

module.exports = {
  getPool,
  pool: {
    query: (text, params) => query(text, params),
    connect: () => getPool().connect(),
    end: () => closePool(),
  },
  query,
  closePool,
  runMigrations,
};
