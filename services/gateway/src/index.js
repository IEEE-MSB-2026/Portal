const app = require('./app');
const config = require('./config');
const { closePool } = require('./db/pool');

const server = app.listen(config.port, () => {
  console.log(`[Gateway] service listening on port ${config.port} (${process.env.NODE_ENV || 'development'})`);
});

async function gracefulShutdown(signal) {
  console.log(`[Gateway] Received ${signal}, initiating graceful shutdown...`);
  server.close(async () => {
    try {
      await closePool();
      console.log('[Gateway] Database pool closed. Process terminated.');
      process.exit(0);
    } catch (err) {
      console.error('[Gateway] Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
