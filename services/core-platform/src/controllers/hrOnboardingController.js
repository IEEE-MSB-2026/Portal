const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const usersRepository = require('../repositories/usersRepository');
const hrOnboardingRepository = require('../repositories/hrOnboardingRepository');

const ALLOWED_ONBOARDING_STATUSES = new Set(['todo', 'done']);

function toOnboardingItemResponse(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    assigneeUserRefId: row.assignee_user_ref_id,
    assigneeUserId: row.assignee_external_user_id,
    templateKey: row.template_key,
    title: row.title,
    sortOrder: row.sort_order,
    status: row.status,
    completedAt: row.completed_at,
    completedByUserRefId: row.completed_by_user_ref_id,
    completedByUserId: row.completed_by_external_user_id,
    createdByUserRefId: row.created_by_user_ref_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStatusInput(body) {
  const status = typeof body?.status === 'string' ? body.status.trim() : '';
  if (!ALLOWED_ONBOARDING_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of todo, done');
  }
  return status;
}

async function listOnboardingByUser(req, res, next) {
  try {
    const externalUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!externalUserId) {
      throw new HttpError(400, 'Invalid userId format');
    }

    const targetUser = await usersRepository.findByExternalUserId(externalUserId);
    if (!targetUser) {
      throw new HttpError(404, 'User not found');
    }

    const isSelf = targetUser.id === req.identity.userRefId;
    const isGlobalPrivileged = authzService.isPrivilegedGlobalAccess(req.identity);

    let committeeIds = null;
    if (!isSelf && !isGlobalPrivileged) {
      committeeIds = await authzService.listManageableHrCommitteeIds(req.identity);
    }

    const items = await hrOnboardingRepository.listOnboardingItemsByAssignee({
      assigneeUserRefId: targetUser.id,
      committeeIds,
    });

    if (!isSelf && !isGlobalPrivileged && items.length === 0) {
      throw new HttpError(403, 'Forbidden');
    }

    return res.status(200).json({
      onboarding: {
        userId: targetUser.externalUserId,
        userRefId: targetUser.id,
        items: items.map((row) => toOnboardingItemResponse(row)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateOnboardingItem(req, res, next) {
  try {
    const itemId = req.params.itemId;
    if (!isUuid(itemId)) {
      throw new HttpError(400, 'Invalid itemId format');
    }

    const status = parseStatusInput(req.body || {});
    const item = await hrOnboardingRepository.getOnboardingItemById(itemId);
    if (!item) {
      throw new HttpError(404, 'Onboarding item not found');
    }

    let canUpdate = item.assignee_user_ref_id === req.identity.userRefId;
    if (!canUpdate && authzService.isPrivilegedGlobalAccess(req.identity)) {
      canUpdate = true;
    }

    if (!canUpdate) {
      const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, item.committee_id);
      canUpdate = authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
    }

    if (!canUpdate) {
      throw new HttpError(403, 'Forbidden');
    }

    await hrOnboardingRepository.updateOnboardingItemStatus({
      itemId,
      status,
      actorUserRefId: req.identity.userRefId,
    });

    const updated = await hrOnboardingRepository.getOnboardingItemById(itemId);
    logger.info({
      event: 'hr.onboarding.item_updated',
      requestId: req.requestId,
      itemId,
      applicationId: updated.application_id,
      committeeId: updated.committee_id,
      actorUserId: req.identity.externalUserId,
      status,
    });

    return res.status(200).json({
      item: toOnboardingItemResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listOnboardingByUser,
  updateOnboardingItem,
};
