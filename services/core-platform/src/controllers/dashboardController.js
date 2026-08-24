const usersRepository = require('../repositories/usersRepository');
const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const announcementsRepository = require('../repositories/announcementsRepository');
const { decodeCursor, parseLimit } = require('../utils/pagination');
const { HttpError } = require('../utils/httpErrors');

function isValidSecureUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) return false;
  const trimmed = urlString.trim();
  if (trimmed.startsWith('/local-uploads/')) return true;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function getMyDashboard(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const cursor = decodeCursor(req.query.cursor);

    const [userRef, committees, assignedTasks, recentActivity, recentAnnouncements] = await Promise.all([
      usersRepository.findByExternalUserId(req.identity.externalUserId),
      committeesRepository.listCommitteesForUser(req.identity.userRefId),
      tasksRepository.listAssignedTasks(req.identity.userRefId, { limit, cursor }),
      taskActivityRepository.listRecentActivityForUserCommittees(req.identity.userRefId, { limit: 20 }),
      announcementsRepository.listRecentAnnouncementsForUserCommittees(req.identity.userRefId, { limit: 20 }),
    ]);

    return res.status(200).json({
      user: {
        userId: req.identity.externalUserId,
        email: req.identity.email,
        role: req.identity.role,
        scopeType: req.identity.scopeType,
        scopeId: req.identity.scopeId,
        avatarUrl: userRef?.avatarUrl || null,
      },
      committees,
      tasks: assignedTasks,
      recentActivity,
      recentAnnouncements,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMyAvatar(req, res, next) {
  try {
    const avatarUrl = req.body?.avatarUrl;
    if (!avatarUrl || !isValidSecureUrl(avatarUrl)) {
      throw new HttpError(400, 'avatarUrl must be a valid secure URL');
    }

    const updated = await usersRepository.updateUserAvatar(req.identity.userRefId, avatarUrl.trim());
    if (!updated) {
      throw new HttpError(404, 'User profile not found');
    }

    return res.status(200).json({
      success: true,
      avatarUrl: updated.avatarUrl,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyDashboard,
  updateMyAvatar,
};

