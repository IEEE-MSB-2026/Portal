const config = require('../config');
const cloudinaryService = require('../services/cloudinaryService');

const FOLDER_ALIASES = {
  event_albums: 'media_albums',
  albums: 'media_albums',
  brand: 'brand_kit',
  brand_assets: 'brand_kit',
  brandkit: 'brand_kit',
};

function normalizeFolder(folder) {
  const raw = typeof folder === 'string' ? folder.trim().toLowerCase() : 'general';
  const stripped = raw.replace(/^ieee_portal\//, '');
  return FOLDER_ALIASES[stripped] || stripped;
}

async function getUploadSignature(req, res, next) {
  try {
    const { folder, resourceType, customTransform, tags, publicId } = req.body || {};

    const targetFolder = normalizeFolder(folder);
    if (!config.allowedFolders.has(targetFolder)) {
      return res.status(400).json({
        error: `Invalid folder. Allowed folders: ${Array.from(config.allowedFolders).join(', ')}`,
      });
    }

    // Role-based folder restriction: applicants/visitors are only allowed to upload to 'applications' or 'general'
    if (['applicant', 'visitor'].includes(req.identity?.role)) {
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

    const folder = normalizeFolder(req.body?.folder);
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

async function registerAsset(req, res, next) {
  try {
    const {
      cloudinaryAssetId,
      cloudinary_asset_id,
      cloudinaryPublicId,
      cloudinary_public_id,
      secureUrl,
      secure_url,
      resourceType,
      resource_type,
      format,
      bytes,
      purpose,
    } = req.body || {};

    const assetId = cloudinaryAssetId || cloudinary_asset_id;
    const publicId = cloudinaryPublicId || cloudinary_public_id;
    const url = secureUrl || secure_url;
    const resType = resourceType || resource_type || 'image';
    const cleanPurpose = typeof purpose === 'string' && purpose.trim() ? purpose.trim().toLowerCase() : 'general';

    if (!assetId || !publicId || !url) {
      return res.status(400).json({
        error: 'cloudinary_asset_id, cloudinary_public_id, and secure_url are required to register an asset',
      });
    }

    // Universal 10MB file size cap enforcement on registered assets
    const MAX_ASSET_BYTES = 10 * 1024 * 1024;
    if (bytes && Number(bytes) > MAX_ASSET_BYTES) {
      return res.status(400).json({
        error: `File size of ${(Number(bytes) / (1024 * 1024)).toFixed(1)}MB exceeds the maximum allowed limit of 10MB (file governance policy)`,
      });
    }

    const { query } = require('../db/pool');
    const rawOwnerUserId = req.identity?.userId || req.identity?.userRefId || null;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ownerUserId = rawOwnerUserId && UUID_REGEX.test(rawOwnerUserId) ? rawOwnerUserId : null;

    const result = await query(
      `INSERT INTO file_assets (
        owner_user_id,
        purpose,
        cloudinary_asset_id,
        cloudinary_public_id,
        resource_type,
        format,
        secure_url,
        bytes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, owner_user_id, purpose, cloudinary_asset_id, cloudinary_public_id, resource_type, format, secure_url, bytes, created_at`,
      [
        ownerUserId,
        cleanPurpose,
        assetId,
        publicId,
        resType,
        format || null,
        url,
        bytes || null,
      ]
    );

    const row = result.rows[0];
    return res.status(201).json({
      success: true,
      asset: {
        id: row.id,
        ownerUserId: row.owner_user_id,
        ownerUserRefId: row.owner_user_id,
        purpose: row.purpose,
        cloudinaryAssetId: row.cloudinary_asset_id,
        cloudinaryPublicId: row.cloudinary_public_id,
        resourceType: row.resource_type,
        format: row.format,
        secureUrl: row.secure_url,
        bytes: row.bytes ? Number(row.bytes) : null,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteAssetById(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Asset ID is required' });
    }

    const { query } = require('../db/pool');
    const existing = await query(
      'SELECT id, cloudinary_public_id, resource_type, secure_url FROM file_assets WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'File asset not found' });
    }

    const asset = existing.rows[0];
    const destroyResult = await cloudinaryService.destroyAsset({
      publicId: asset.cloudinary_public_id,
      resourceType: asset.resource_type || 'image',
    });

    await query('DELETE FROM file_assets WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: 'Asset successfully destroyed and unregistered',
      deletedId: id,
      publicId: asset.cloudinary_public_id,
      cloudinary: destroyResult,
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteAssetByUrl(req, res, next) {
  try {
    const url = req.body?.url || req.query?.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL is required' });
    }

    const { query } = require('../db/pool');
    const existing = await query(
      'SELECT id, cloudinary_public_id, resource_type, secure_url FROM file_assets WHERE secure_url = $1 LIMIT 1',
      [url]
    );

    let publicId;
    let resourceType = 'image';
    let assetId = null;

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      publicId = row.cloudinary_public_id;
      resourceType = row.resource_type || 'image';
      assetId = row.id;
      await query('DELETE FROM file_assets WHERE id = $1', [row.id]);
    } else {
      publicId = cloudinaryService.extractPublicIdFromUrl(url);
      if (url.includes('/video/')) resourceType = 'video';
      else if (url.includes('/raw/')) resourceType = 'raw';
    }

    if (!publicId) {
      return res.status(400).json({ error: 'Could not extract Cloudinary public ID from URL' });
    }

    const destroyResult = await cloudinaryService.destroyAsset({
      publicId,
      resourceType,
    });

    return res.status(200).json({
      success: true,
      message: 'Asset successfully destroyed by URL',
      url,
      publicId,
      deletedAssetId: assetId,
      cloudinary: destroyResult,
    });
  } catch (err) {
    return next(err);
  }
}

async function processPendingDeletions({ limit = 50 } = {}) {
  const { query } = require('../db/pool');

  const result = await query(
    `SELECT id, cloudinary_public_id, secure_url, resource_type, retry_count
     FROM file_assets
     WHERE status = 'pending_deletion'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  const pending = result.rows;
  if (pending.length === 0) return { processedCount: 0 };

  let processedCount = 0;
  for (const item of pending) {
    try {
      let publicId = item.cloudinary_public_id;
      let resourceType = item.resource_type || 'image';

      if (!publicId && item.secure_url) {
        publicId = cloudinaryService.extractPublicIdFromUrl(item.secure_url);
      }

      if (publicId && !publicId.startsWith('untracked_') && !publicId.startsWith('legacy_')) {
        await cloudinaryService.destroyAsset({
          publicId,
          resourceType,
        });
      }

      // Hard-delete the row from file_assets once Cloudinary confirms destruction
      await query('DELETE FROM file_assets WHERE id = $1', [item.id]);
      processedCount++;
    } catch (err) {
      const nextRetry = (item.retry_count || 0) + 1;
      const finalStatus = nextRetry >= 3 ? 'failed' : 'pending_deletion';
      await query(
        `UPDATE file_assets
         SET status = $2, retry_count = $3, error_message = $4, processed_at = NOW()
         WHERE id = $1`,
        [item.id, finalStatus, nextRetry, err.message]
      );
    }
  }

  return { processedCount };
}

async function triggerProcessDeletions(req, res, next) {
  try {
    const limit = parseInt(req.body?.limit || req.query?.limit, 10) || 50;
    const result = await processPendingDeletions({ limit });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return next(err);
  }
}

async function cleanupOrphans(req, res, next) {
  try {
    const dryRun = req.query?.dryRun === 'true' || req.body?.dryRun === true;
    const { query } = require('../db/pool');

    const orphanQuery = `
      SELECT fa.id, fa.cloudinary_public_id, fa.resource_type, fa.secure_url, fa.created_at
      FROM file_assets fa
      WHERE fa.status = 'active'
        AND fa.created_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_url = fa.secure_url OR u.cloudinary_public_id = fa.cloudinary_public_id)
        AND NOT EXISTS (SELECT 1 FROM pr_announcements pa WHERE pa.image_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM media_albums ma WHERE ma.cover_image_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM media_album_assets maa WHERE maa.asset_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM media_brand_assets mba WHERE mba.file_url = fa.secure_url OR mba.thumbnail_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM committee_resources cr WHERE cr.url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM committee_assignments ca WHERE ca.attachment_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM assignment_submissions asub WHERE asub.file_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM branch_officers bo WHERE bo.avatar_url = fa.secure_url)
        AND NOT EXISTS (SELECT 1 FROM hr_applications ha WHERE ha.answers->>'cvUrl' = fa.secure_url OR ha.answers->>'resumeUrl' = fa.secure_url)
        AND fa.purpose NOT IN ('event_cover', 'events')
        AND COALESCE(fa.cloudinary_public_id, '') NOT LIKE 'events/%'
      ORDER BY fa.created_at ASC
      LIMIT 100
    `;

    const orphansRes = await query(orphanQuery);
    const orphans = orphansRes.rows;

    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        orphanCount: orphans.length,
        orphans: orphans.map((o) => ({
          id: o.id,
          publicId: o.cloudinary_public_id,
          secureUrl: o.secure_url,
          createdAt: o.created_at,
        })),
      });
    }

    let purgedCount = 0;
    for (const orphan of orphans) {
      try {
        if (orphan.cloudinary_public_id) {
          await cloudinaryService.destroyAsset({
            publicId: orphan.cloudinary_public_id,
            resourceType: orphan.resource_type || 'image',
          });
        }
        await query('DELETE FROM file_assets WHERE id = $1', [orphan.id]);
        purgedCount++;
      } catch (err) {
        console.error(`[Orphan Cleanup] Failed to purge asset ${orphan.id}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      purgedCount,
      orphanCount: orphans.length,
    });
  } catch (err) {
    return next(err);
  }
}

function getServiceConfig(req, res) {
  return res.status(200).json({
    service: 'portal-file-service',
    uploadMode: config.cloudinary.isConfigured ? 'cloudinary' : 'test_mock',
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
  registerAsset,
  deleteAssetById,
  deleteAssetByUrl,
  processPendingDeletions,
  triggerProcessDeletions,
  cleanupOrphans,
};
