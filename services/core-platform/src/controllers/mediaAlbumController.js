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
    createdByUserId: row.created_by_external_user_id || row.created_by_user_id,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

function toAlbumResponse(row) {
  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    committeeSlug: row.committee_slug,
    title: row.title,
    description: row.description,
    coverImageUrl: row.cover_image_url || (Array.isArray(row.assets) && row.assets.length > 0 ? row.assets[0].asset_url : null),
    eventDate: row.event_date || null,
    category: row.category || 'General',
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: row.status,
    publishedAt: row.published_at,
    assetsCount: typeof row.assets_count === 'number' ? row.assets_count : (Array.isArray(row.assets) ? row.assets.length : 0),
    assets: Array.isArray(row.assets) ? row.assets.map(toAssetResponse) : [],
    createdByUserRefId: row.created_by_user_ref_id,
    createdByUserId: row.created_by_external_user_id || row.created_by_user_id,
    createdByName: row.created_by_name || null,
    updatedByUserRefId: row.updated_by_user_ref_id,
    updatedByUserId: row.updated_by_external_user_id || row.updated_by_user_id,
    updatedByName: row.updated_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCreateInput(body) {
  const committeeIdRaw = typeof body?.committeeId === 'string' ? body.committeeId.trim() : (body?.committeeId === null ? null : '');
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const coverImageUrl = typeof body?.coverImageUrl === 'string' ? body.coverImageUrl.trim() : null;
  const eventDate = body?.eventDate ? body.eventDate : null;
  const category = typeof body?.category === 'string' ? body.category.trim() : 'General';
  const tags = Array.isArray(body?.tags) ? body.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];

  let committeeId = null;
  if (committeeIdRaw) {
    if (!isUuid(committeeIdRaw)) {
      throw new HttpError(400, 'committeeId must be a valid UUID');
    }
    committeeId = committeeIdRaw;
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
    eventDate,
    category,
    tags,
    assets,
  };
}

function parseAssetInput(body) {
  const assetUrl = typeof body?.assetUrl === 'string' ? body.assetUrl.trim() : '';
  const assetType = typeof body?.assetType === 'string' ? body.assetType.trim() : 'image';
  const caption = typeof body?.caption === 'string' ? body.caption.trim() : '';

  if (!assetUrl) {
    throw new HttpError(400, 'assetUrl is required');
  }

  return {
    assetUrl,
    assetType: assetType || 'image',
    caption: caption || null,
  };
}

async function ensureMediaManageAccess(identity, committeeId) {
  const membershipRole = committeeId ? await authzService.getMembershipRoleForCommittee(identity, committeeId) : null;
  const canManage = await authzService.canManageMediaCommittee({
    identity,
    membershipRole,
    committeeId,
  });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden: Media management privileges required');
  }
}

async function createAlbum(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});
    if (payload.committeeId) {
      const committee = await committeesRepository.getCommitteeById(payload.committeeId);
      if (!committee) {
        throw new HttpError(404, 'Committee not found');
      }
    }

    await ensureMediaManageAccess(req.identity, payload.committeeId);

    const album = await mediaAlbumsRepository.createAlbum({
      committeeId: payload.committeeId,
      title: payload.title,
      description: payload.description,
      coverImageUrl: payload.coverImageUrl,
      eventDate: payload.eventDate,
      category: payload.category,
      tags: payload.tags,
      assets: payload.assets,
      actorUserRefId: req.identity.userRefId,
      actorUserId: req.identity.externalUserId,
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

async function getAlbum(req, res, next) {
  try {
    const albumId = req.params.albumId;
    if (!isUuid(albumId)) {
      throw new HttpError(400, 'Invalid albumId format');
    }

    const album = await mediaAlbumsRepository.getAlbumById(albumId);
    if (!album) {
      throw new HttpError(404, 'Album not found');
    }

    return res.status(200).json({
      album: toAlbumResponse(album),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAlbum(req, res, next) {
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

    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    const coverImageUrl = typeof body.coverImageUrl === 'string' ? body.coverImageUrl.trim() : undefined;
    const eventDate = body.eventDate !== undefined ? body.eventDate : undefined;
    const category = typeof body.category === 'string' ? body.category.trim() : undefined;
    const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : undefined;

    let committeeId = undefined;
    if (body.committeeId !== undefined) {
      if (body.committeeId === null || body.committeeId === '') {
        committeeId = null;
      } else if (typeof body.committeeId === 'string' && isUuid(body.committeeId.trim())) {
        committeeId = body.committeeId.trim();
        const committee = await committeesRepository.getCommitteeById(committeeId);
        if (!committee) {
          throw new HttpError(404, 'Committee not found');
        }
      } else {
        throw new HttpError(400, 'committeeId must be a valid UUID or null');
      }
    }

    const updated = await mediaAlbumsRepository.updateAlbum({
      albumId,
      title,
      description,
      coverImageUrl,
      eventDate,
      category,
      tags,
      committeeId,
      actorUserRefId: req.identity.userRefId,
      actorUserId: req.identity.externalUserId,
    });

    logger.info({
      event: 'media.album.updated',
      requestId: req.requestId,
      albumId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      album: toAlbumResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteAlbum(req, res, next) {
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

    await mediaAlbumsRepository.deleteAlbum(albumId);

    logger.info({
      event: 'media.album.deleted',
      requestId: req.requestId,
      albumId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      success: true,
      deletedAlbumId: albumId,
    });
  } catch (error) {
    return next(error);
  }
}

async function listAlbums(req, res, next) {
  try {
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const status = typeof req.query?.status === 'string' ? req.query.status.trim() : null;
    const search = typeof req.query?.search === 'string' ? req.query.search.trim() : null;
    const limit = parseLimit(req.query?.limit, 50, 100);
    const offset = Math.max(Number(req.query?.offset) || 0, 0);

    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    let targetCommitteeId = committeeId || null;
    if (committeeId) {
      await ensureMediaManageAccess(req.identity, committeeId);
    } else {
      const isMediaLeadOrAdmin = await authzService.isMediaCommitteeLead(req.identity);
      if (!isMediaLeadOrAdmin && !authzService.isPrivilegedGlobalAccess(req.identity)) {
        const manageableIds = await authzService.listManageableMediaCommitteeIds(req.identity);
        if (Array.isArray(manageableIds) && manageableIds.length === 0) {
          throw new HttpError(403, 'Forbidden');
        }
      }
    }

    const albums = await mediaAlbumsRepository.listAlbums({
      committeeId: targetCommitteeId,
      status,
      search,
      limit,
      offset,
    });

    return res.status(200).json({
      albums: albums.map((album) => toAlbumResponse(album)),
      limit,
      offset,
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
      actorUserId: req.identity.externalUserId,
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

async function deleteAlbumAsset(req, res, next) {
  try {
    const { albumId, assetId } = req.params;
    if (!isUuid(albumId) || !isUuid(assetId)) {
      throw new HttpError(400, 'Invalid albumId or assetId format');
    }

    const album = await mediaAlbumsRepository.getAlbumById(albumId);
    if (!album) {
      throw new HttpError(404, 'Album not found');
    }

    await ensureMediaManageAccess(req.identity, album.committee_id);

    await mediaAlbumsRepository.deleteAlbumAsset({ albumId, assetId });

    logger.info({
      event: 'media.album.asset_deleted',
      requestId: req.requestId,
      albumId,
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

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, album.committee_id);
    const canPublish = await authzService.canPublishMediaAlbum({
      identity: req.identity,
      committeeId: album.committee_id,
      membershipRole,
    });
    if (!canPublish) {
      throw new HttpError(403, 'Forbidden: Publishing privileges required');
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
      actorUserId: req.identity.externalUserId,
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

async function unpublishAlbum(req, res, next) {
  try {
    const albumId = req.params.albumId;
    if (!isUuid(albumId)) {
      throw new HttpError(400, 'Invalid albumId format');
    }

    const album = await mediaAlbumsRepository.getAlbumById(albumId);
    if (!album) {
      throw new HttpError(404, 'Album not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, album.committee_id);
    const canPublish = await authzService.canPublishMediaAlbum({
      identity: req.identity,
      committeeId: album.committee_id,
      membershipRole,
    });
    if (!canPublish) {
      throw new HttpError(403, 'Forbidden: Publishing privileges required');
    }

    const unpublished = await mediaAlbumsRepository.unpublishAlbum({
      albumId,
      actorUserRefId: req.identity.userRefId,
      actorUserId: req.identity.externalUserId,
    });

    logger.info({
      event: 'media.album.unpublished',
      requestId: req.requestId,
      albumId,
      committeeId: album.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      album: toAlbumResponse(unpublished),
    });
  } catch (error) {
    return next(error);
  }
}

async function getMediaStats(req, res, next) {
  try {
    const stats = await mediaAlbumsRepository.getMediaStats();
    return res.status(200).json(stats);
  } catch (error) {
    return next(error);
  }
}

async function listPublicAlbums(req, res, next) {
  try {
    const limit = parseLimit(req.query?.limit, 50, 100);
    const albums = await mediaAlbumsRepository.listAlbums({
      status: 'published',
      limit,
    });

    return res.status(200).json({
      albums: albums.map((album) => toAlbumResponse(album)),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  addAlbumAsset,
  createAlbum,
  deleteAlbum,
  deleteAlbumAsset,
  getAlbum,
  getMediaStats,
  listAlbums,
  listPublicAlbums,
  publishAlbum,
  unpublishAlbum,
  updateAlbum,
};
