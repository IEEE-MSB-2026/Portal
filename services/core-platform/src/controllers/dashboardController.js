const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const announcementsRepository = require('../repositories/announcementsRepository');
const { decodeCursor, parseLimit } = require('../utils/pagination');

async function getMyDashboard(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const cursor = decodeCursor(req.query.cursor);

    const [committees, assignedTasks, recentActivity, recentAnnouncements] = await Promise.all([
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

module.exports = {
  getMyDashboard,
};
