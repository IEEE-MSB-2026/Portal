require('dotenv').config();

function parsePositiveInt(val, defaultVal) {
  const parsed = parseInt(val, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultVal;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parsePositiveInt(process.env.PORT, 5080),
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET || 'dev-gateway-secret-change-in-prod',
  
  // Cloudinary credentials
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    isConfigured: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ),
  },

  // Strict Credit-saving rules & constraints for Cloudinary
  creditSaving: {
    rootFolder: process.env.CLOUDINARY_ROOT_FOLDER || 'ieee_portal',

    // Transformations enforced on all direct uploads and deliveries to save bandwidth & transformation credits
    defaultEagerTransform: 'f_auto,q_auto,c_limit,w_1920,h_1080',
    avatarTransform: 'f_auto,q_auto,c_fill,w_400,h_400,g_face',
    thumbnailTransform: 'f_auto,q_auto,c_limit,w_600,h_400',

    // File size limits in megabytes
    maxImageSizeMb: parsePositiveInt(process.env.MAX_IMAGE_SIZE_MB, 5),
    maxDocSizeMb: parsePositiveInt(process.env.MAX_DOC_SIZE_MB, 15),
    maxVideoSizeMb: parsePositiveInt(process.env.MAX_VIDEO_SIZE_MB, 25),

    // Signature expiration in seconds
    signatureExpirySeconds: parsePositiveInt(process.env.SIGNATURE_EXPIRY_SECONDS, 3600),
  },

  // Allowed folder categories
  allowedFolders: new Set([
    'media_albums',
    'resources',
    'avatars',
    'events',
    'applications',
    'announcements',
    'general',
  ]),
};

module.exports = config;
