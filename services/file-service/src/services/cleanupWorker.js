const fileController = require('../controllers/fileController');

let outboxTimer = null;
let orphanTimer = null;
let isProcessingOutbox = false;
let isProcessingOrphans = false;

function startCleanupWorker({
  outboxIntervalMs = 30000, // 30 seconds
  orphanIntervalMs = 24 * 60 * 60 * 1000, // 24 hours
} = {}) {
  stopCleanupWorker();

  // 1. Outbox Drain Worker
  outboxTimer = setInterval(async () => {
    if (isProcessingOutbox) return;
    isProcessingOutbox = true;
    try {
      const { processedCount } = await fileController.processPendingDeletions({ limit: 50 });
      if (processedCount > 0) {
        console.log(`[FileService Outbox] Processed ${processedCount} pending Cloudinary deletions`);
      }
    } catch (err) {
      console.error('[FileService Outbox Worker Error]:', err.message);
    } finally {
      isProcessingOutbox = false;
    }
  }, outboxIntervalMs);

  // 2. Daily 24h Orphan Sweeper Worker
  orphanTimer = setInterval(async () => {
    if (isProcessingOrphans) return;
    isProcessingOrphans = true;
    try {
      console.log('[FileService Orphan Sweeper] Running 24-hour unlinked asset cleanup routine...');
      const result = await new Promise((resolve) => {
        const fakeReq = { query: { dryRun: 'false' } };
        const fakeRes = {
          status: () => ({
            json: (data) => resolve(data),
          }),
        };
        fileController.cleanupOrphans(fakeReq, fakeRes, (err) => resolve({ error: err.message }));
      });
      if (result.purgedCount > 0) {
        console.log(`[FileService Orphan Sweeper] Successfully purged ${result.purgedCount} orphan assets from Cloudinary and database`);
      }
    } catch (err) {
      console.error('[FileService Orphan Sweeper Error]:', err.message);
    } finally {
      isProcessingOrphans = false;
    }
  }, orphanIntervalMs);

  console.log(`[FileService] Background cleanup workers active (Outbox: ${outboxIntervalMs / 1000}s, Orphans: ${orphanIntervalMs / 1000}s)`);
}

function stopCleanupWorker() {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
  if (orphanTimer) {
    clearInterval(orphanTimer);
    orphanTimer = null;
  }
}

module.exports = {
  startCleanupWorker,
  stopCleanupWorker,
};
