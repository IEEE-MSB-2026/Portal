const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const committeesRepository = require('../repositories/committeesRepository');
const prAnnouncementsRepository = require('../repositories/prAnnouncementsRepository');

const ALLOWED_VISIBILITY = new Set(['internal', 'public']);

function toAnnouncementResponse(row) {
  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    title: row.title,
    body: row.body,
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
  const committeeId = typeof body?.committeeId === 'string' ? body.committeeId.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const announcementBody = typeof body?.body === 'string' ? body.body.trim() : '';
  const visibility = parseVisibility(body?.visibility, 'internal');

  if (!isUuid(committeeId)) {
    throw new HttpError(400, 'committeeId is required and must be a valid UUID');
  }
  if (!title) {
    throw new HttpError(400, 'title is required');
  }
  if (!announcementBody) {
    throw new HttpError(400, 'body is required');
  }

  return { committeeId, title, body: announcementBody, visibility };
}

function parseUpdateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : null;
  const announcementBody = typeof body?.body === 'string' ? body.body.trim() : null;
  const visibility = parseVisibility(body?.visibility, null);

  if (title !== null && !title) {
    throw new HttpError(400, 'title must not be empty');
  }
  if (announcementBody !== null && !announcementBody) {
    throw new HttpError(400, 'body must not be empty');
  }
  if (title === null && announcementBody === null && visibility === null) {
    throw new HttpError(400, 'At least one of title, body, visibility is required');
  }

  return {
    hasTitle: title !== null,
    title,
    hasBody: announcementBody !== null,
    body: announcementBody,
    hasVisibility: visibility !== null,
    visibility,
  };
}

async function ensureManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = authzService.canManagePrCommittee({
    identity,
    membershipRole,
    committeeId,
  });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden');
  }
}

async function createAnnouncement(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});
    const committee = await committeesRepository.getCommitteeById(payload.committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    await ensureManageAccess(req.identity, payload.committeeId);

    const announcement = await prAnnouncementsRepository.createAnnouncement({
      committeeId: payload.committeeId,
      title: payload.title,
      body: payload.body,
      visibility: payload.visibility,
      actorUserRefId: req.identity.userRefId,
    });

    await prAnnouncementsRepository.createActivity({
      announcementId: announcement.id,
      action: 'created',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        title: announcement.title,
        visibility: announcement.visibility,
      },
    });

    logger.info({
      event: 'pr.announcement.created',
      requestId: req.requestId,
      announcementId: announcement.id,
      committeeId: announcement.committee_id,
      actorUserId: req.identity.externalUserId,
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
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const visibility = parseVisibility(req.query?.visibility, null);
    const includeDeleted = parseBoolean(req.query?.includeDeleted, false);
    const limit = parseLimit(req.query?.limit, 50, 100);

    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    let effectiveCommitteeIds = null;
    if (committeeId) {
      await ensureManageAccess(req.identity, committeeId);
    } else {
      effectiveCommitteeIds = await authzService.listManageablePrCommitteeIds(req.identity);
      if (Array.isArray(effectiveCommitteeIds) && effectiveCommitteeIds.length === 0) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const announcements = await prAnnouncementsRepository.listAnnouncements({
      committeeId: committeeId || null,
      committeeIds: committeeId ? null : effectiveCommitteeIds,
      visibility,
      includeDeleted,
      limit,
    });

    return res.status(200).json({
      announcements: announcements.map((row) => toAnnouncementResponse(row)),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAnnouncement(req, res, next) {
  try {
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

    await ensureManageAccess(req.identity, existing.committee_id);

    const payload = parseUpdateInput(req.body || {});
    const updated = await prAnnouncementsRepository.updateAnnouncement({
      announcementId,
      title: payload.hasTitle ? payload.title : existing.title,
      body: payload.hasBody ? payload.body : existing.body,
      visibility: payload.hasVisibility ? payload.visibility : existing.visibility,
      actorUserRefId: req.identity.userRefId,
    });

    if (!updated) {
      throw new HttpError(404, 'Announcement not found');
    }

    await prAnnouncementsRepository.createActivity({
      announcementId: updated.id,
      action: 'updated',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        before: {
          title: existing.title,
          body: existing.body,
          visibility: existing.visibility,
        },
        after: {
          title: updated.title,
          body: updated.body,
          visibility: updated.visibility,
        },
      },
    });

    logger.info({
      event: 'pr.announcement.updated',
      requestId: req.requestId,
      announcementId: updated.id,
      committeeId: updated.committee_id,
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
    const announcementId = req.params.announcementId;
    if (!isUuid(announcementId)) {
      throw new HttpError(400, 'Invalid announcementId format');
    }

    const existing = await prAnnouncementsRepository.getAnnouncementById(announcementId, {
      includeDeleted: true,
    });
    if (!existing) {
      throw new HttpError(404, 'Announcement not found');
    }

    await ensureManageAccess(req.identity, existing.committee_id);

    if (existing.deleted_at) {
      return res.status(200).json({
        announcement: toAnnouncementResponse(existing),
      });
    }

    const deleted = await prAnnouncementsRepository.softDeleteAnnouncement({
      announcementId,
      actorUserRefId: req.identity.userRefId,
    });

    await prAnnouncementsRepository.createActivity({
      announcementId,
      action: 'deleted',
      actorUserRefId: req.identity.userRefId,
      metadata: {
        title: existing.title,
        visibility: existing.visibility,
      },
    });

    logger.info({
      event: 'pr.announcement.deleted',
      requestId: req.requestId,
      announcementId,
      committeeId: existing.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      announcement: toAnnouncementResponse(deleted || existing),
    });
  } catch (error) {
    return next(error);
  }
}

async function listPublicAnnouncements(req, res, next) {
  try {
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const limit = parseLimit(req.query?.limit, 50, 100);

    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const announcements = await prAnnouncementsRepository.listAnnouncements({
      committeeId: committeeId || null,
      committeeIds: null,
      visibility: 'public',
      includeDeleted: false,
      limit,
    });

    return res.status(200).json({
      announcements: announcements.map((row) => ({
        id: row.id,
        committeeId: row.committee_id,
        committeeName: row.committee_name,
        title: row.title,
        body: row.body,
        visibility: row.visibility,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listPublicAnnouncements,
  updateAnnouncement,
};
