const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const committeesRepository = require('../repositories/committeesRepository');
const mediaAlbumsRepository = require('../repositories/mediaAlbumsRepository');

function toAssetResponse(row) {
  return {
    id: row.id,
    albumId: row.album_id,
    assetUrl: row.asset_url,
    assetType: row.asset_type,
    caption: row.caption,
    createdByUserRefId: row.created_by_user_ref_id,
    createdByUserId: row.created_by_external_user_id,
    createdAt: row.created_at,
  };
}

function toAlbumResponse(row) {
  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    title: row.title,
    description: row.description,
    coverImageUrl: row.cover_image_url || (Array.isArray(row.assets) && row.assets.length > 0 ? row.assets[0].asset_url : null),
    status: row.status,
    publishedAt: row.published_at,
    assetsCount: typeof row.assets_count === 'number' ? row.assets_count : (Array.isArray(row.assets) ? row.assets.length : 0),
    assets: Array.isArray(row.assets) ? row.assets.map(toAssetResponse) : [],
    createdByUserRefId: row.created_by_user_ref_id,
    createdByUserId: row.created_by_external_user_id,
    updatedByUserRefId: row.updated_by_user_ref_id,
    updatedByUserId: row.updated_by_external_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCreateInput(body) {
  const committeeId = typeof body?.committeeId === 'string' ? body.committeeId.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const coverImageUrl = typeof body?.coverImageUrl === 'string' ? body.coverImageUrl.trim() : null;

  if (!isUuid(committeeId)) {
    throw new HttpError(400, 'committeeId is required and must be a valid UUID');
  }
  if (!title) {
    throw new HttpError(400, 'title is required');
  }

  let assets = [];
  if (Array.isArray(body?.assets)) {
    assets = body.assets.map((item, idx) => {
      const assetUrl = typeof item?.assetUrl === 'string' ? item.assetUrl.trim() : '';
      const assetType = typeof item?.assetType === 'string' ? item.assetType.trim() : 'image';
      const caption = typeof item?.caption === 'string' ? item.caption.trim() : null;
      if (!assetUrl) {
        throw new HttpError(400, `assets[${idx}].assetUrl is required`);
      }
      return { assetUrl, assetType, caption };
    });
  }

  return {
    committeeId,
    title,
    description: description || null,
    coverImageUrl: coverImageUrl || null,
    assets,
  };
}

function parseAssetInput(body) {
  const assetUrl = typeof body?.assetUrl === 'string' ? body.assetUrl.trim() : '';
  const assetType = typeof body?.assetType === 'string' ? body.assetType.trim() : '';
  const caption = typeof body?.caption === 'string' ? body.caption.trim() : '';

  if (!assetUrl) {
    throw new HttpError(400, 'assetUrl is required');
  }
  if (!assetType) {
    throw new HttpError(400, 'assetType is required');
  }

  return {
    assetUrl,
    assetType,
    caption: caption || null,
  };
}

async function ensureMediaManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = authzService.canManageMediaCommittee({
    identity,
    membershipRole,
    committeeId,
  });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden');
  }
}

async function createAlbum(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});
    const committee = await committeesRepository.getCommitteeById(payload.committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    await ensureMediaManageAccess(req.identity, payload.committeeId);

    const album = await mediaAlbumsRepository.createAlbum({
      committeeId: payload.committeeId,
      title: payload.title,
      description: payload.description,
      coverImageUrl: payload.coverImageUrl,
      assets: payload.assets,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'media.album.created',
      requestId: req.requestId,
      albumId: album.id,
      committeeId: album.committee_id,
      actorUserId: req.identity.externalUserId,
      assetsCount: album.assets?.length || 0,
    });

    return res.status(201).json({
      album: toAlbumResponse(album),
    });
  } catch (error) {
    return next(error);
  }
}

async function listAlbums(req, res, next) {
  try {
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const limit = parseLimit(req.query?.limit, 50, 100);

    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    let committeeIds = null;
    if (committeeId) {
      await ensureMediaManageAccess(req.identity, committeeId);
    } else {
      committeeIds = await authzService.listManageableMediaCommitteeIds(req.identity);
      if (Array.isArray(committeeIds) && committeeIds.length === 0) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const albums = await mediaAlbumsRepository.listAlbums({
      committeeId: committeeId || null,
      committeeIds: committeeId ? null : committeeIds,
      limit,
    });

    return res.status(200).json({
      albums: albums.map((album) => toAlbumResponse(album)),
    });
  } catch (error) {
    return next(error);
  }
}

async function addAlbumAsset(req, res, next) {
  try {
    const albumId = req.params.albumId;
    if (!isUuid(albumId)) {
      throw new HttpError(400, 'Invalid albumId format');
    }

    const album = await mediaAlbumsRepository.getAlbumById(albumId);
    if (!album) {
      throw new HttpError(404, 'Album not found');
    }

    await ensureMediaManageAccess(req.identity, album.committee_id);
    const payload = parseAssetInput(req.body || {});

    const asset = await mediaAlbumsRepository.addAlbumAsset({
      albumId,
      assetUrl: payload.assetUrl,
      assetType: payload.assetType,
      caption: payload.caption,
      actorUserRefId: req.identity.userRefId,
    });

    const assetDetails = await mediaAlbumsRepository.listAlbumAssets(albumId, { limit: 500 });
    const createdAsset = assetDetails.find((item) => item.id === asset.id) || assetDetails[assetDetails.length - 1];

    logger.info({
      event: 'media.album.asset_added',
      requestId: req.requestId,
      albumId,
      assetId: asset.id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      asset: toAssetResponse(createdAsset),
    });
  } catch (error) {
    return next(error);
  }
}

async function publishAlbum(req, res, next) {
  try {
    const albumId = req.params.albumId;
    if (!isUuid(albumId)) {
      throw new HttpError(400, 'Invalid albumId format');
    }

    const album = await mediaAlbumsRepository.getAlbumById(albumId);
    if (!album) {
      throw new HttpError(404, 'Album not found');
    }

    const canPublish = authzService.canPublishMediaAlbum({
      identity: req.identity,
      committeeId: album.committee_id,
    });
    if (!canPublish) {
      throw new HttpError(403, 'Forbidden');
    }

    const assetCount = await mediaAlbumsRepository.countAlbumAssets(albumId);
    if (assetCount === 0) {
      throw new HttpError(400, 'Cannot publish an album without at least one media asset/image');
    }

    if (album.status === 'published') {
      return res.status(200).json({
        album: toAlbumResponse(album),
      });
    }

    const published = await mediaAlbumsRepository.publishAlbum({
      albumId,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'media.album.published',
      requestId: req.requestId,
      albumId,
      committeeId: album.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      album: toAlbumResponse(published),
    });
  } catch (error) {
    return next(error);
  }
}

async function listPublicAlbums(req, res, next) {
  try {
    const limit = parseLimit(req.query?.limit, 50, 100);
    const albums = await mediaAlbumsRepository.listAlbums({
      limit,
    });

    const publishedOnly = albums.filter((album) => album.status === 'published');
    return res.status(200).json({
      albums: publishedOnly.map((album) => toAlbumResponse(album)),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  addAlbumAsset,
  createAlbum,
  listAlbums,
  listPublicAlbums,
  publishAlbum,
};
