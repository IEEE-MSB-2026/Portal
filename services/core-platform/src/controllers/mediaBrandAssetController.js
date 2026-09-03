const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const mediaBrandAssetsRepository = require('../repositories/mediaBrandAssetsRepository');

function toBrandAssetResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    fileUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    fileFormat: row.file_format,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdByUserId: row.created_by_external_user_id || row.created_by_user_id,
    createdByName: row.created_by_name || null,
    updatedByUserId: row.updated_by_external_user_id || row.updated_by_user_id,
    updatedByName: row.updated_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCreateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim().toLowerCase() : 'logos';
  const fileUrl = typeof body?.fileUrl === 'string' ? body.fileUrl.trim() : '';
  const thumbnailUrl = typeof body?.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : '';
  const fileFormat = typeof body?.fileFormat === 'string' ? body.fileFormat.trim().toLowerCase() : '';
  const fileSizeBytes = Number(body?.fileSizeBytes) || 0;
  const tags = Array.isArray(body?.tags) ? body.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];

  if (!title) {
    throw new HttpError(400, 'title is required');
  }
  if (!fileUrl) {
    throw new HttpError(400, 'fileUrl is required');
  }

  const validCategories = new Set(['logos', 'templates', 'badges', 'documents']);
  const normalizedCategory = validCategories.has(category) ? category : 'logos';

  return {
    title,
    description: description || null,
    category: normalizedCategory,
    fileUrl,
    thumbnailUrl: thumbnailUrl || null,
    fileFormat: fileFormat || null,
    fileSizeBytes,
    tags,
  };
}

async function ensureMediaManageAccess(identity) {
  const canManage = await authzService.canManageMediaCommittee({ identity });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden: Media management privileges required');
  }
}

async function listBrandAssets(req, res, next) {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = await mediaBrandAssetsRepository.listBrandAssets({
      category,
      search,
      limit,
      offset,
    });

    return res.status(200).json({
      assets: rows.map(toBrandAssetResponse),
      limit,
      offset,
    });
  } catch (error) {
    return next(error);
  }
}

async function createBrandAsset(req, res, next) {
  try {
    await ensureMediaManageAccess(req.identity);
    const payload = parseCreateInput(req.body || {});

    const asset = await mediaBrandAssetsRepository.createBrandAsset({
      ...payload,
      actorUserRefId: req.identity.userRefId,
      actorUserId: req.identity.externalUserId,
    });

    logger.info({
      event: 'media.brand_asset.created',
      requestId: req.requestId,
      assetId: asset.id,
      category: asset.category,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      asset: toBrandAssetResponse(asset),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateBrandAsset(req, res, next) {
  try {
    await ensureMediaManageAccess(req.identity);
    const assetId = req.params.assetId;
    if (!isUuid(assetId)) {
      throw new HttpError(400, 'Invalid assetId format');
    }

    const current = await mediaBrandAssetsRepository.getBrandAssetById(assetId);
    if (!current) {
      throw new HttpError(404, 'Brand asset not found');
    }

    const payload = req.body || {};
    const title = typeof payload.title === 'string' ? payload.title.trim() : undefined;
    const description = typeof payload.description === 'string' ? payload.description.trim() : undefined;
    const category = typeof payload.category === 'string' ? payload.category.trim().toLowerCase() : undefined;
    const fileUrl = typeof payload.fileUrl === 'string' ? payload.fileUrl.trim() : undefined;
    const thumbnailUrl = typeof payload.thumbnailUrl === 'string' ? payload.thumbnailUrl.trim() : undefined;
    const fileFormat = typeof payload.fileFormat === 'string' ? payload.fileFormat.trim().toLowerCase() : undefined;
    const fileSizeBytes = payload.fileSizeBytes !== undefined ? Number(payload.fileSizeBytes) || 0 : undefined;
    const tags = Array.isArray(payload.tags) ? payload.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : undefined;

    const updated = await mediaBrandAssetsRepository.updateBrandAsset({
      assetId,
      title,
      description,
      category,
      fileUrl,
      thumbnailUrl,
      fileFormat,
      fileSizeBytes,
      tags,
      actorUserRefId: req.identity.userRefId,
      actorUserId: req.identity.externalUserId,
    });

    logger.info({
      event: 'media.brand_asset.updated',
      requestId: req.requestId,
      assetId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      asset: toBrandAssetResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteBrandAsset(req, res, next) {
  try {
    await ensureMediaManageAccess(req.identity);
    const assetId = req.params.assetId;
    if (!isUuid(assetId)) {
      throw new HttpError(400, 'Invalid assetId format');
    }

    const current = await mediaBrandAssetsRepository.getBrandAssetById(assetId);
    if (!current) {
      throw new HttpError(404, 'Brand asset not found');
    }

    await mediaBrandAssetsRepository.deleteBrandAsset(assetId);

    logger.info({
      event: 'media.brand_asset.deleted',
      requestId: req.requestId,
      assetId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      success: true,
      deletedAssetId: assetId,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBrandAsset,
  deleteBrandAsset,
  listBrandAssets,
  updateBrandAsset,
};
