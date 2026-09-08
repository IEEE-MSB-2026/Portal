const app = require('./app');
const config = require('./config');
const { startCleanupWorker, stopCleanupWorker } = require('./services/cleanupWorker');

const server = app.listen(config.port, () => {
  console.log(`[FileService] Running on port ${config.port} (Cloudinary: ${config.cloudinary.isConfigured ? 'CONNECTED' : 'MOCK/LOCAL'})`);
  startCleanupWorker();
});

const gracefulShutdown = () => {
  console.log('[FileService] Initiating graceful shutdown...');
  stopCleanupWorker();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
