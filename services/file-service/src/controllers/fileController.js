const config = require('../config');
const cloudinaryService = require('../services/cloudinaryService');

async function getUploadSignature(req, res, next) {
  try {
    const { folder, resourceType, customTransform, tags, publicId } = req.body || {};

    const targetFolder = typeof folder === 'string' ? folder.trim().toLowerCase() : 'general';
    if (!config.allowedFolders.has(targetFolder)) {
      return res.status(400).json({
        error: `Invalid folder. Allowed folders: ${Array.from(config.allowedFolders).join(', ')}`,
      });
    }

    // Role-based folder restriction: applicants/visitors are only allowed to upload to 'applications' or 'general'
    if (['applicant', 'visitor'].includes(req.identity.role)) {
      if (!['applications', 'general'].includes(targetFolder)) {
        return res.status(403).json({
          error: 'Applicants can only request upload signatures for application attachments or general files',
        });
      }
    }

    const signatureData = cloudinaryService.createUploadSignature({
      folder: targetFolder,
      resourceType: resourceType || 'auto',
      customTransform: customTransform || null,
      tags: tags || ['ieee_portal', targetFolder],
      publicId: publicId || null,
    });

    return res.status(200).json({
      success: true,
      ...signatureData,
    });
  } catch (err) {
    return next(err);
  }
}

async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = typeof req.body?.folder === 'string' ? req.body.folder.trim().toLowerCase() : 'general';
    if (!config.allowedFolders.has(folder)) {
      return res.status(400).json({
        error: `Invalid folder. Allowed folders: ${Array.from(config.allowedFolders).join(', ')}`,
      });
    }

    // Check file size limits to protect credits
    const fileSizeMb = req.file.size / (1024 * 1024);
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');

    if (isImage && fileSizeMb > config.creditSaving.maxImageSizeMb) {
      return res.status(400).json({
        error: `Image exceeds maximum allowed size of ${config.creditSaving.maxImageSizeMb}MB (credit saving policy)`,
      });
    }
    if (isVideo && fileSizeMb > config.creditSaving.maxVideoSizeMb) {
      return res.status(400).json({
        error: `Video exceeds maximum allowed size of ${config.creditSaving.maxVideoSizeMb}MB`,
      });
    }
    if (!isImage && !isVideo && fileSizeMb > config.creditSaving.maxDocSizeMb) {
      return res.status(400).json({
        error: `Document exceeds maximum allowed size of ${config.creditSaving.maxDocSizeMb}MB`,
      });
    }

    const result = await cloudinaryService.uploadBuffer({
      buffer: req.file.buffer,
      folder,
      filename: req.file.originalname,
      resourceType: isVideo ? 'video' : (isImage ? 'image' : 'raw'),
      customTransform: req.body?.customTransform || null,
    });

    return res.status(201).json({
      success: true,
      file: result,
    });
  } catch (err) {
    return next(err);
  }
}

function getServiceConfig(req, res) {
  return res.status(200).json({
    service: 'portal-file-service',
    uploadMode: config.cloudinary.isConfigured ? 'cloudinary' : 'local_mock',
    cloudName: config.cloudinary.cloudName || 'demo',
    allowedFolders: Array.from(config.allowedFolders),
    creditSavingPolicy: {
      autoFormat: true,
      autoQuality: true,
      defaultTransform: config.creditSaving.defaultEagerTransform,
      avatarTransform: config.creditSaving.avatarTransform,
      maxImageSizeMb: config.creditSaving.maxImageSizeMb,
      maxDocSizeMb: config.creditSaving.maxDocSizeMb,
      maxVideoSizeMb: config.creditSaving.maxVideoSizeMb,
    },
  });
}

module.exports = {
  getConfig: getServiceConfig,
  getUploadSignature,
  uploadFile,
};
