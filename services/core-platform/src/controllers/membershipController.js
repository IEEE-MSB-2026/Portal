const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const usersRepository = require('../repositories/usersRepository');
const membershipsRepository = require('../repositories/membershipsRepository');
const authzService = require('../services/authzService');

function parseMembershipInput(body) {
  const externalUserId = typeof body.externalUserId === 'string' ? body.externalUserId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const roleInCommittee = typeof body.roleInCommittee === 'string' ? body.roleInCommittee.trim() : '';

  if (!externalUserId) {
    throw new HttpError(400, 'externalUserId is required');
  }
  if (!email) {
    throw new HttpError(400, 'email is required');
  }
  if (!['member', 'lead'].includes(roleInCommittee)) {
    throw new HttpError(400, 'roleInCommittee must be member or lead');
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

    const membership = await membershipsRepository.upsertMembership({
      committeeId,
      userRefId: userRef.id,
      roleInCommittee: payload.roleInCommittee,
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
        committeeId: membership.committee_id,
        userRefId: membership.user_ref_id,
        externalUserId: payload.externalUserId,
        roleInCommittee: membership.role_in_committee,
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

    if (targetMembership.roleInCommittee === 'lead' && req.identity.role !== 'admin') {
      throw new HttpError(403, 'Only admin can remove committee lead');
    }

    if (targetMembership.roleInCommittee === 'lead') {
      const leadCount = await membershipsRepository.countLeadsInCommittee(committeeId);
      if (leadCount <= 1) {
        throw new HttpError(400, 'Cannot remove the last committee lead');
      }
    }

    await membershipsRepository.deleteMembership({ committeeId, userRefId: targetUser.id });

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
  listCommitteeMemberships,
  removeCommitteeMembership,
  searchCommitteeMembers,
  upsertCommitteeMembership,
};
