const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const resourcesRepository = require('../repositories/resourcesRepository');
const authzService = require('../services/authzService');

function parseResourceInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!title) throw new HttpError(400, 'title is required');
  if (!url) throw new HttpError(400, 'url is required');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'url must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'url must use http or https');
  }

  return {
    title,
    url: parsed.toString(),
    description: description || null,
  };
}

async function listCommitteeResources(req, res, next) {
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

    const resources = await resourcesRepository.listResourcesByCommittee(committeeId, { limit: 50 });
    return res.status(200).json({ resources });
  } catch (error) {
    return next(error);
  }
}

async function createCommitteeResource(req, res, next) {
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

    const payload = parseResourceInput(req.body || {});
    const resource = await resourcesRepository.createResource({
      committeeId,
      title: payload.title,
      url: payload.url,
      description: payload.description,
      createdByUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'committee.resource.created',
      requestId: req.requestId,
      committeeId,
      resourceId: resource.id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      resource: {
        id: resource.id,
        committeeId: resource.committee_id,
        title: resource.title,
        url: resource.url,
        description: resource.description,
        createdAt: resource.created_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCommitteeResource,
  listCommitteeResources,
};
