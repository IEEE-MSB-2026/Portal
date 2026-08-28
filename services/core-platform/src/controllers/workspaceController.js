const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { decodeCursor, parseLimit } = require('../utils/pagination');
const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const resourcesRepository = require('../repositories/resourcesRepository');
const authzService = require('../services/authzService');

async function getCommitteeWorkspace(req, res, next) {
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

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);

    const limit = parseLimit(req.query.limit, 50, 100);
    const cursor = decodeCursor(req.query.cursor);
    const isArchived = req.query.isArchived === 'true' || req.query.archived === 'true';

    const [taskSummary, tasks, resources] = await Promise.all([
      tasksRepository.getCommitteeTaskSummary(committeeId),
      tasksRepository.listCommitteeTasks(committeeId, { limit, cursor, isArchived }),
      resourcesRepository.listResourcesByCommittee(committeeId, { limit: 50 }),
    ]);

    return res.status(200).json({
      committee: {
        id: committee.id,
        slug: committee.slug,
        name: committee.name,
        isActive: committee.is_active,
        myRole: membershipRole,
      },
      taskSummary,
      tasks,
      resources,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCommitteeWorkspace,
};
