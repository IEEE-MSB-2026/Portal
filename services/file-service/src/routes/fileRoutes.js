const express = require('express');
const multer = require('multer');
const fileController = require('../controllers/fileController');
const { parseAuthIdentity } = require('../middlewares/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB hard memory limit
});

const router = express.Router();

router.use(parseAuthIdentity);

router.post('/signature', fileController.getUploadSignature);
router.post('/upload', upload.single('file'), fileController.uploadFile);
router.get('/config', fileController.getConfig);

module.exports = router;
