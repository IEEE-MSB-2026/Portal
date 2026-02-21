const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const announcementsRepository = require('../repositories/announcementsRepository');
const membershipsRepository = require('../repositories/membershipsRepository');
const authzService = require('../services/authzService');
const emailNotificationService = require('../services/emailNotificationService');

function parseAnnouncementInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.body === 'string' ? body.body.trim() : '';

  if (!title) throw new HttpError(400, 'title is required');
  if (!content) throw new HttpError(400, 'body is required');

  return { title, body: content };
}

async function listCommitteeAnnouncements(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const canRead = await authzService.canReadCommittee(req.identity, committeeId);
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const announcements = await announcementsRepository.listAnnouncementsByCommittee(committeeId, { limit: 50 });
    return res.status(200).json({ announcements });
  } catch (error) {
    return next(error);
  }
}

async function createCommitteeAnnouncement(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    const canManage = authzService.canManageCommitteeContent({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    const payload = parseAnnouncementInput(req.body || {});
    const announcement = await announcementsRepository.createAnnouncement({
      committeeId,
      title: payload.title,
      body: payload.body,
      createdByUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'committee.announcement.created',
      requestId: req.requestId,
      committeeId,
      announcementId: announcement.id,
      actorUserId: req.identity.externalUserId,
    });

    const memberships = await membershipsRepository.listMembershipsByCommittee(committeeId);
    const notificationResult = await emailNotificationService.sendCommitteeAnnouncementNotifications({
      requestId: req.requestId,
      route: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
      committeeName: committee.name,
      announcementId: announcement.id,
      announcementTitle: announcement.title,
      announcementBody: announcement.body,
      actorExternalUserId: req.identity.externalUserId,
      actorEmail: req.identity.email,
      recipientEmails: memberships.map((membership) => membership.email),
    });

    if (!notificationResult.ok) {
      logger.warn({
        event: 'committee.announcement.notification.undelivered',
        requestId: req.requestId,
        committeeId,
        announcementId: announcement.id,
        reason: notificationResult.reason,
        sentCount: notificationResult.sentCount,
        failedCount: notificationResult.failedCount,
        skippedCount: notificationResult.skippedCount,
      }, 'Committee announcement email notifications were partially delivered or skipped');
    }

    return res.status(201).json({
      announcement: {
        id: announcement.id,
        committeeId: announcement.committee_id,
        title: announcement.title,
        body: announcement.body,
        createdAt: announcement.created_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCommitteeAnnouncement,
  listCommitteeAnnouncements,
};
