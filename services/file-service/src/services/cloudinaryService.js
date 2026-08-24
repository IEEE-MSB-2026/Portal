const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');

// Initialize Cloudinary if credentials are present
if (config.cloudinary.isConfigured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

// Ensure local upload directory exists for mock/fallback mode
if (config.creditSaving.enableLocalFallback) {
  try {
    if (!fs.existsSync(config.creditSaving.localUploadDir)) {
      fs.mkdirSync(config.creditSaving.localUploadDir, { recursive: true });
    }
  } catch (err) {
    // ignore
  }
}

/**
 * Generate Direct Upload Presigned Signature for Client Uploads
 * Injects mandatory credit-saving transformations (f_auto,q_auto,dimensions)
 */
function createUploadSignature({
  folder = 'general',
  resourceType = 'auto',
  customTransform = null,
  tags = ['ieee_portal'],
  publicId = null,
}) {
  const normalizedFolder = config.allowedFolders.has(folder) ? folder : 'general';
  const targetFolder = `${config.creditSaving.rootFolder}/${normalizedFolder}`;
  const timestamp = Math.round(Date.now() / 1000);

  // Determine eager transformation for bandwidth and format credit savings
  let eager = customTransform;
  if (!eager) {
    if (normalizedFolder === 'avatars') {
      eager = config.creditSaving.avatarTransform;
    } else {
      eager = config.creditSaving.defaultEagerTransform;
    }
  }

  // Parameters to be signed
  const paramsToSign = {
    folder: targetFolder,
    timestamp,
  };

  if (eager) {
    paramsToSign.eager = eager;
  }
  if (tags && Array.isArray(tags) && tags.length > 0) {
    paramsToSign.tags = tags.join(',');
  }
  if (publicId) {
    paramsToSign.public_id = publicId;
  }

  let signature = '';
  if (config.cloudinary.isConfigured) {
    signature = cloudinary.utils.api_sign_request(paramsToSign, config.cloudinary.apiSecret);
  } else {
    // Mock signature for local/test mode
    signature = `mock_signature_${timestamp}_${randomUUID().slice(0, 8)}`;
  }

  const cloudName = config.cloudinary.cloudName || 'ieee-menoufia-demo';
  const apiKey = config.cloudinary.apiKey || 'mock-api-key';
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  return {
    uploadMode: config.cloudinary.isConfigured ? 'cloudinary' : 'local_mock',
    uploadUrl,
    signature,
    timestamp,
    apiKey,
    cloudName,
    folder: targetFolder,
    eager,
    tags: paramsToSign.tags || null,
    publicId: paramsToSign.public_id || null,
    creditSavingPolicy: {
      autoFormat: true,
      autoQuality: true,
      maxDimension: '1920x1080',
      maxImageSizeMb: config.creditSaving.maxImageSizeMb,
      maxDocSizeMb: config.creditSaving.maxDocSizeMb,
    },
  };
}

/**
 * Server-side Direct Buffer Upload with Credit Optimization
 */
async function uploadBuffer({
  buffer,
  folder = 'general',
  filename = 'file',
  resourceType = 'auto',
  customTransform = null,
}) {
  const normalizedFolder = config.allowedFolders.has(folder) ? folder : 'general';
  const targetFolder = `${config.creditSaving.rootFolder}/${normalizedFolder}`;

  let eager = customTransform;
  if (!eager) {
    if (normalizedFolder === 'avatars') {
      eager = config.creditSaving.avatarTransform;
    } else {
      eager = config.creditSaving.defaultEagerTransform;
    }
  }

  // 1. Cloudinary upload if configured
  if (config.cloudinary.isConfigured) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: targetFolder,
          resource_type: resourceType,
          eager: eager ? [eager] : undefined,
          tags: ['ieee_portal', normalizedFolder],
        },
        (error, result) => {
          if (error) return reject(error);

          // Get optimized secure URL
          let optimizedUrl = result.secure_url;
          if (result.eager && result.eager.length > 0 && result.eager[0].secure_url) {
            optimizedUrl = result.eager[0].secure_url;
          }

          resolve({
            provider: 'cloudinary',
            publicId: result.public_id,
            secureUrl: optimizedUrl,
            rawUrl: result.secure_url,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
            resourceType: result.resource_type,
            folder: targetFolder,
          });
        }
      );

      uploadStream.end(buffer);
    });
  }

  // 2. Local fallback storage
  const fileId = `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const localFilePath = path.join(config.creditSaving.localUploadDir, fileId);
  await fs.promises.writeFile(localFilePath, buffer);

  return {
    provider: 'local_mock',
    publicId: `${targetFolder}/${fileId}`,
    secureUrl: `http://localhost:${config.port}/local-uploads/${fileId}`,
    rawUrl: `http://localhost:${config.port}/local-uploads/${fileId}`,
    format: path.extname(filename).replace('.', '') || 'bin',
    bytes: buffer.length,
    folder: targetFolder,
  };
}

module.exports = {
  createUploadSignature,
  uploadBuffer,
};
