const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const membershipsRepository = require('../repositories/membershipsRepository');
const usersRepository = require('../repositories/usersRepository');
const authzService = require('../services/authzService');
const iamRoleAssignmentService = require('../services/iamRoleAssignmentService');

const ALLOWED_ROLES = new Set(['member', 'lead', 'hr']);

function parseMembershipInput(body) {
  const externalUserId = typeof body.externalUserId === 'string' ? body.externalUserId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const roleInCommittee = typeof body.roleInCommittee === 'string' ? body.roleInCommittee.trim() : '';

  if (!externalUserId && !email) {
    throw new HttpError(400, 'externalUserId or email is required');
  }
  if (!ALLOWED_ROLES.has(roleInCommittee)) {
    throw new HttpError(400, 'roleInCommittee must be one of member, lead, hr');
  }

  return { externalUserId, email, roleInCommittee };
}

async function listCommitteeMemberships(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const canRead = (await authzService.canReadCommittee(req.identity, committeeId)) || (await authzService.isHrCommitteeLead(req.identity));
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const memberships = await membershipsRepository.listMembershipsByCommittee(committeeId);
    return res.status(200).json({ memberships });
  } catch (error) {
    return next(error);
  }
}

async function listAllMemberships(req, res, next) {
  try {
    const hasAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
    if (!hasAccess) {
      throw new HttpError(403, 'Forbidden');
    }

    const memberships = await membershipsRepository.listAllMemberships();
    return res.status(200).json({ memberships });
  } catch (error) {
    return next(error);
  }
}

async function searchRegisteredUsers(req, res, next) {
  try {
    const hasAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
    if (!hasAccess) {
      throw new HttpError(403, 'Forbidden');
    }

    const queryTerm = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!queryTerm) {
      return res.status(200).json({ users: [] });
    }

    const users = await usersRepository.searchUsers(queryTerm, 20);
    return res.status(200).json({ users });
  } catch (error) {
    return next(error);
  }
}

async function upsertCommitteeMembership(req, res, next) {
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
    const canManage = await authzService.canManageMemberships({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    const payload = parseMembershipInput(req.body || {});
    const userRef = await usersRepository.ensureUserRef({
      externalUserId: payload.externalUserId,
      email: payload.email,
    });

    const memberships = await membershipsRepository.listMembershipsByCommittee(committeeId);
    const existingMembership = memberships.find((m) => m.userRefId === userRef.id);

    if (payload.roleInCommittee === 'lead' || (existingMembership && existingMembership.roleInCommittee === 'lead' && payload.roleInCommittee !== 'lead')) {
      if (!authzService.canPromoteOrDemoteLead(req.identity)) {
        throw new HttpError(403, 'Only administrators and officers can promote or demote committee leads');
      }
    }

    const membership = await membershipsRepository.upsertMembership({
      committeeId,
      userRefId: userRef.id,
      roleInCommittee: payload.roleInCommittee,
    });

    await iamRoleAssignmentService.syncRoleAssignment({
      userId: payload.externalUserId || userRef.external_user_id || userRef.id,
      role: payload.roleInCommittee,
      scopeType: 'committee',
      scopeId: committeeId,
    });

    logger.info({
      event: 'committee.membership.upserted',
      requestId: req.requestId,
      committeeId,
      targetUserId: payload.externalUserId,
      roleInCommittee: payload.roleInCommittee,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      membership: {
        id: membership.id,
        committeeId: membership.committeeId,
        userRefId: membership.userRefId,
        externalUserId: payload.externalUserId || userRef.external_user_id || userRef.id,
        roleInCommittee: membership.roleInCommittee,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function removeCommitteeMembership(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    const externalUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';

    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }
    if (!externalUserId) {
      throw new HttpError(400, 'Invalid userId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    const canManage = await authzService.canManageMemberships({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    const targetUser = await usersRepository.findByExternalUserId(externalUserId);
    if (!targetUser) {
      throw new HttpError(404, 'Membership not found');
    }

    const memberships = await membershipsRepository.listMembershipsByCommittee(committeeId);
    const targetMembership = memberships.find((m) => m.userRefId === targetUser.id);
    if (!targetMembership) {
      throw new HttpError(404, 'Membership not found');
    }

    if (targetMembership.roleInCommittee === 'lead') {
      if (!authzService.canPromoteOrDemoteLead(req.identity)) {
        throw new HttpError(403, 'Only admin can remove committee lead');
      }

      const leadCount = await membershipsRepository.countLeadsInCommittee(committeeId);
      if (leadCount <= 1) {
        throw new HttpError(400, 'Cannot remove the last committee lead');
      }
    }

    await membershipsRepository.deleteMembership({ committeeId, userRefId: targetUser.id });

    await iamRoleAssignmentService.syncRoleRevocation({
      userId: targetUser.external_user_id || externalUserId,
      scopeType: 'committee',
      scopeId: committeeId,
    });

    logger.info({
      event: 'committee.membership.removed',
      requestId: req.requestId,
      committeeId,
      targetUserId: externalUserId,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({ message: 'Membership removed' });
  } catch (error) {
    return next(error);
  }
}

async function searchCommitteeMembers(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const canRead = (await authzService.canReadCommittee(req.identity, committeeId)) || (await authzService.isHrCommitteeLead(req.identity));
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const search = typeof req.query?.search === 'string' ? req.query.search : undefined;
    const id = typeof req.query?.id === 'string' && isUuid(req.query.id) ? req.query.id : undefined;

    const members = await membershipsRepository.searchCommitteeMembers(committeeId, { search, id });
    return res.status(200).json({ members });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listAllMemberships,
  listCommitteeMemberships,
  removeCommitteeMembership,
  searchCommitteeMembers,
  searchRegisteredUsers,
  upsertCommitteeMembership,
};
