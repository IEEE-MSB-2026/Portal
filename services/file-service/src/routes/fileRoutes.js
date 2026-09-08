const express = require('express');
const multer = require('multer');
const fileController = require('../controllers/fileController');
const { parseAuthIdentity } = require('../middlewares/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB hard memory limit (quota preservation)
});

const router = express.Router();

router.use(parseAuthIdentity);

router.post('/signature', fileController.getUploadSignature);
router.post('/upload', upload.single('file'), fileController.uploadFile);
router.post('/assets', fileController.registerAsset);
router.get('/config', fileController.getConfig);

// Cloudinary Asset Deletions & Outbox Processing
router.delete('/assets/:id', fileController.deleteAssetById);
router.delete('/by-url', fileController.deleteAssetByUrl);
router.post('/cleanup/orphans', fileController.cleanupOrphans);
router.post('/cleanup/process-deletions', fileController.triggerProcessDeletions);

module.exports = router;
