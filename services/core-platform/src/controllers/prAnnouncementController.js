const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const prAnnouncementsRepository = require('../repositories/prAnnouncementsRepository');

const ALLOWED_VISIBILITY = new Set(['internal', 'public']);
const ALLOWED_ADMIN_ROLES = new Set(['admin', 'officer', 'publisher', 'lead']);

function toAnnouncementResponse(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category || 'General',
    imageUrl: row.image_url || null,
    isPinned: Boolean(row.is_pinned),
    authorName: row.author_name || 'Branch Executive Board',
    visibility: row.visibility,
    createdByUserRefId: row.created_by_user_ref_id,
    createdByUserId: row.created_by_external_user_id,
    updatedByUserRefId: row.updated_by_user_ref_id,
    updatedByUserId: row.updated_by_external_user_id,
    deletedByUserRefId: row.deleted_by_user_ref_id,
    deletedByUserId: row.deleted_by_external_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function parseVisibility(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const visibility = String(value).trim();
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    throw new HttpError(400, 'visibility must be one of internal, public');
  }
  return visibility;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new HttpError(400, 'includeDeleted must be boolean');
}

function parseCreateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const announcementBody = typeof body?.body === 'string' ? body.body.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim() : 'General';
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : null;
  const isPinned = body?.isPinned !== undefined ? Boolean(body.isPinned) : false;
  const authorName = typeof body?.authorName === 'string' ? body.authorName.trim() : 'Branch Executive Board';
  const visibility = parseVisibility(body?.visibility, 'public');

  if (!title) {
    throw new HttpError(400, 'title is required');
  }

  return {
    title,
    body: announcementBody || '',
    category,
    imageUrl: imageUrl || null,
    isPinned,
    authorName,
    visibility,
  };
}

function parseUpdateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : null;
  const announcementBody = typeof body?.body === 'string' ? body.body.trim() : (body?.body === null || body?.body === '' ? '' : null);
  const category = typeof body?.category === 'string' ? body.category.trim() : null;
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : (body?.imageUrl === null ? null : undefined);
  const isPinned = body?.isPinned !== undefined ? Boolean(body.isPinned) : undefined;
  const authorName = typeof body?.authorName === 'string' ? body.authorName.trim() : null;
  const visibility = parseVisibility(body?.visibility, null);

  if (title !== null && !title) {
    throw new HttpError(400, 'title must not be empty');
  }
  if (
    title === null &&
    announcementBody === null &&
    category === null &&
    visibility === null &&
    imageUrl === undefined &&
    isPinned === undefined &&
    authorName === null
  ) {
    throw new HttpError(400, 'At least one field to update is required');
  }

  return {
    hasTitle: title !== null,
    title,
    hasBody: announcementBody !== null,
    body: announcementBody,
    hasCategory: category !== null,
    category,
    hasImageUrl: imageUrl !== undefined,
    imageUrl: imageUrl || null,
    hasIsPinned: isPinned !== undefined,
    isPinned,
    hasAuthorName: authorName !== null,
    authorName,
    hasVisibility: visibility !== null,
    visibility,
  };
}

function ensureGlobalManageAccess(identity) {
  const role = identity?.role;
  const isGlobalPublisher = ALLOWED_ADMIN_ROLES.has(role) || identity?.scopeType === 'global';
  if (!isGlobalPublisher) {
    throw new HttpError(403, 'Forbidden: Official announcement management requires admin, officer, or publisher role');
  }
}

async function createAnnouncement(req, res, next) {
  try {
    ensureGlobalManageAccess(req.identity);
    const payload = parseCreateInput(req.body || {});

    const announcement = await prAnnouncementsRepository.createAnnouncement({
      title: payload.title,
      body: payload.body,
      category: payload.category,
      imageUrl: payload.imageUrl,
      isPinned: payload.isPinned,
      authorName: payload.authorName,
      visibility: payload.visibility,
      actorUserRefId: req.identity.userRefId,
    });

    await prAnnouncementsRepository.createActivityLog({
      announcementId: announcement.id,
      action: 'created',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        title: announcement.title,
        category: announcement.category,
        isPinned: announcement.is_pinned,
        visibility: announcement.visibility,
      },
    });

    logger.info({
      event: 'pr.announcement.created',
      requestId: req.requestId,
      announcementId: announcement.id,
      actorUserId: req.identity.externalUserId,
      category: announcement.category,
      visibility: announcement.visibility,
    });

    return res.status(201).json({
      announcement: toAnnouncementResponse(announcement),
    });
  } catch (error) {
    return next(error);
  }
}

async function listAnnouncements(req, res, next) {
  try {
    ensureGlobalManageAccess(req.identity);

    const category = typeof req.query?.category === 'string' ? req.query.category.trim() : null;
    const search = typeof req.query?.search === 'string' ? req.query.search.trim() : null;
    const visibility = parseVisibility(req.query?.visibility, null);
    const includeDeleted = parseBoolean(req.query?.includeDeleted, false);
    const limit = parseLimit(req.query?.limit, 50, 100);
    const offset = Math.max(0, Number.parseInt(req.query?.offset, 10) || 0);

    const announcements = await prAnnouncementsRepository.listAnnouncements({
      category,
      search,
      visibility,
      includeDeleted,
      limit,
      offset,
    });

    return res.status(200).json({
      announcements: announcements.map(toAnnouncementResponse),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAnnouncement(req, res, next) {
  try {
    ensureGlobalManageAccess(req.identity);

    const announcementId = req.params.announcementId;
    if (!isUuid(announcementId)) {
      throw new HttpError(400, 'Invalid announcementId format');
    }

    const existing = await prAnnouncementsRepository.getAnnouncementById(announcementId, {
      includeDeleted: true,
    });
    if (!existing || existing.deleted_at) {
      throw new HttpError(404, 'Announcement not found');
    }

    const payload = parseUpdateInput(req.body || {});
    const updated = await prAnnouncementsRepository.updateAnnouncement({
      announcementId,
      title: payload.hasTitle ? payload.title : existing.title,
      body: payload.hasBody ? payload.body : existing.body,
      category: payload.hasCategory ? payload.category : existing.category,
      imageUrl: payload.hasImageUrl ? payload.imageUrl : existing.image_url,
      isPinned: payload.hasIsPinned ? payload.isPinned : existing.is_pinned,
      authorName: payload.hasAuthorName ? payload.authorName : existing.author_name,
      visibility: payload.hasVisibility ? payload.visibility : existing.visibility,
      actorUserRefId: req.identity.userRefId,
    });

    if (!updated) {
      throw new HttpError(404, 'Announcement not found');
    }

    await prAnnouncementsRepository.createActivityLog({
      announcementId: updated.id,
      action: 'updated',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        before: {
          title: existing.title,
          category: existing.category,
          visibility: existing.visibility,
        },
        after: {
          title: updated.title,
          category: updated.category,
          visibility: updated.visibility,
        },
      },
    });

    logger.info({
      event: 'pr.announcement.updated',
      requestId: req.requestId,
      announcementId: updated.id,
      actorUserId: req.identity.externalUserId,
      visibility: updated.visibility,
    });

    return res.status(200).json({
      announcement: toAnnouncementResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteAnnouncement(req, res, next) {
  try {
    ensureGlobalManageAccess(req.identity);

    const announcementId = req.params.announcementId;
    if (!isUuid(announcementId)) {
      throw new HttpError(400, 'Invalid announcementId format');
    }

    const existing = await prAnnouncementsRepository.getAnnouncementById(announcementId, {
      includeDeleted: true,
    });
    if (!existing || existing.deleted_at) {
      throw new HttpError(404, 'Announcement not found');
    }

    const deleted = await prAnnouncementsRepository.softDeleteAnnouncement({
      announcementId,
      actorUserRefId: req.identity.userRefId,
    });

    if (!deleted) {
      throw new HttpError(404, 'Announcement not found');
    }

    await prAnnouncementsRepository.createActivityLog({
      announcementId: deleted.id,
      action: 'deleted',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        title: deleted.title,
      },
    });

    logger.info({
      event: 'pr.announcement.deleted',
      requestId: req.requestId,
      announcementId: deleted.id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      success: true,
      announcementId: deleted.id,
      announcement: toAnnouncementResponse(deleted),
    });
  } catch (error) {
    return next(error);
  }
}

async function listPublicAnnouncements(req, res, next) {
  try {
    const category = typeof req.query?.category === 'string' ? req.query.category.trim() : null;
    const search = typeof req.query?.search === 'string' ? req.query.search.trim() : null;
    const limit = parseLimit(req.query?.limit, 50, 100);
    const offset = Math.max(0, Number.parseInt(req.query?.offset, 10) || 0);

    const userRole = req.headers['x-user-role'] || req.identity?.role;
    const scopeType = req.headers['x-scope-type'] || req.identity?.scopeType;
    const hasCommittee = Boolean(req.headers['x-committee-id'] || req.identity?.committeeId);

    const isTeamMember =
      scopeType === 'committee' ||
      scopeType === 'global' ||
      hasCommittee ||
      ['admin', 'officer', 'lead', 'member', 'hr', 'publisher'].includes(userRole);

    let visibility = 'public';
    if (isTeamMember) {
      if (req.query?.visibility === 'internal') {
        visibility = 'internal';
      } else if (req.query?.visibility === 'public') {
        visibility = 'public';
      } else {
        visibility = null; // returns both public and internal
      }
    }

    const announcements = await prAnnouncementsRepository.listAnnouncements({
      category,
      search,
      visibility,
      includeDeleted: false,
      limit,
      offset,
    });

    return res.status(200).json({
      announcements: announcements.map(toAnnouncementResponse),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  listPublicAnnouncements,
};
