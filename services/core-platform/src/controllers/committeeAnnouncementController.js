const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const committeeAnnouncementsRepository = require('../repositories/committeeAnnouncementsRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');

async function createCommitteeAnnouncement(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can create announcements');
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const isPinned = Boolean(req.body?.isPinned);

    if (!title) {
      throw new HttpError(400, 'title is required');
    }
    if (!body) {
      throw new HttpError(400, 'body is required');
    }

    const announcement = await committeeAnnouncementsRepository.createAnnouncement({
      committeeId,
      title,
      body,
      createdByUserId: req.identity.userRefId,
      isPinned,
    });

    await taskActivityRepository.recordCommitteeActivity({
      committeeId,
      actorUserId: req.identity.userRefId,
      activityType: 'announcement_posted',
      title: `posted announcement "${title}"`,
      details: { announcementId: announcement.id, isPinned },
    }).catch(() => {});

    return res.status(201).json({
      message: 'Committee announcement created successfully',
      announcement,
    });
  } catch (error) {
    return next(error);
  }
}

async function listCommitteeAnnouncements(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const canRead = await authzService.canReadCommittee(req.identity, committeeId);
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const announcements = await committeeAnnouncementsRepository.listAnnouncementsByCommittee(committeeId, {
      limit: 50,
    });

    return res.status(200).json({
      announcements,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteCommitteeAnnouncement(req, res, next) {
  try {
    const { committeeId, announcementId } = req.params;
    if (!isUuid(committeeId) || !isUuid(announcementId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can delete announcements');
    }

    const deleted = await committeeAnnouncementsRepository.deleteAnnouncement(announcementId);
    if (!deleted) {
      throw new HttpError(404, 'Announcement not found');
    }

    return res.status(200).json({
      message: 'Announcement deleted successfully',
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCommitteeAnnouncementPin(req, res, next) {
  try {
    const { committeeId, announcementId } = req.params;
    if (!isUuid(committeeId) || !isUuid(announcementId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can update announcements');
    }

    const isPinned = req.body?.isPinned !== undefined ? Boolean(req.body.isPinned) : true;
    const updated = await committeeAnnouncementsRepository.updateAnnouncementPin(announcementId, isPinned);
    if (!updated) {
      throw new HttpError(404, 'Announcement not found');
    }

    return res.status(200).json({
      message: `Announcement ${isPinned ? 'pinned' : 'unpinned'} successfully`,
      announcement: updated,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCommitteeAnnouncement,
  listCommitteeAnnouncements,
  deleteCommitteeAnnouncement,
  updateCommitteeAnnouncementPin,
};
