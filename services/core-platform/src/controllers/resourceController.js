const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const resourcesRepository = require('../repositories/resourcesRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const authzService = require('../services/authzService');

function parseResourceInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const resourceType = typeof body.resourceType === 'string' && body.resourceType.trim()
    ? body.resourceType.trim().toLowerCase()
    : (typeof body.resource_type === 'string' && body.resource_type.trim() ? body.resource_type.trim().toLowerCase() : 'link');

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
    resourceType,
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
      resourceType: payload.resourceType,
      description: payload.description,
      createdByUserRefId: req.identity.userRefId,
    });

    await taskActivityRepository.recordCommitteeActivity({
      committeeId,
      actorUserId: req.identity.userRefId,
      activityType: 'resource_added',
      title: `added resource "${resource.title}"`,
      details: { resourceId: resource.id, resourceType: resource.resourceType },
    }).catch(() => {});

    logger.info({
      event: 'committee.resource.created',
      requestId: req.requestId,
      committeeId,
      resourceId: resource.id,
      actorUserId: req.identity.externalUserId,
      resourceType: resource.resourceType,
    });

    return res.status(201).json({
      resource: {
        id: resource.id,
        committeeId: resource.committeeId,
        title: resource.title,
        url: resource.url,
        resourceType: resource.resourceType,
        description: resource.description,
        createdAt: resource.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCommitteeResource(req, res, next) {
  try {
    const { committeeId, resourceId } = req.params;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }
    if (!isUuid(resourceId)) {
      throw new HttpError(400, 'Invalid resourceId format');
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

    const existing = await resourcesRepository.getResourceById(resourceId);
    if (!existing || existing.committeeId !== committeeId) {
      throw new HttpError(404, 'Resource not found in committee');
    }

    const updateData = {};
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) throw new HttpError(400, 'title cannot be empty');
      updateData.title = title;
    }
    if (req.body?.description !== undefined) {
      updateData.description = req.body.description ? String(req.body.description).trim() : null;
    }

    const updated = await resourcesRepository.updateResource(resourceId, committeeId, updateData);

    return res.status(200).json({
      message: 'Resource updated successfully',
      resource: updated,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteCommitteeResource(req, res, next) {
  try {
    const { committeeId, resourceId } = req.params;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }
    if (!isUuid(resourceId)) {
      throw new HttpError(400, 'Invalid resourceId format');
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

    const existing = await resourcesRepository.getResourceById(resourceId);
    if (!existing || existing.committeeId !== committeeId) {
      throw new HttpError(404, 'Resource not found in committee');
    }

    await resourcesRepository.deleteResource(resourceId, committeeId);

    logger.info({
      event: 'committee.resource.deleted',
      requestId: req.requestId,
      committeeId,
      resourceId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      message: 'Resource deleted successfully',
      resourceId,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listCommitteeResources,
  createCommitteeResource,
  updateCommitteeResource,
  deleteCommitteeResource,
};
