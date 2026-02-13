const committeesRepository = require('../repositories/committeesRepository');

function isGlobalAccess(identity) {
  return identity.role === 'admin' || identity.scopeType === 'global';
}

function canAssignTask({ identity, membershipRole }) {
  if (isGlobalAccess(identity)) return true;
  return membershipRole === 'lead';
}

function canUpdateTaskStatus({ identity, membershipRole, task }) {
  if (isGlobalAccess(identity)) {
    return { allowed: true, mode: 'any' };
  }

  if (membershipRole === 'lead') {
    return { allowed: true, mode: 'any' };
  }

  if (task.assignee_user_ref_id === identity.userRefId) {
    return { allowed: true, mode: 'own' };
  }

  return { allowed: false, mode: 'none' };
}

async function getMembershipRoleForCommittee(identity, committeeId) {
  if (isGlobalAccess(identity)) return 'admin';

  if (identity.scopeType === 'committee' && identity.scopeId !== committeeId) {
    return null;
  }

  return committeesRepository.getMembershipRole(identity.userRefId, committeeId);
}

async function canReadCommittee(identity, committeeId) {
  const membershipRole = await getMembershipRoleForCommittee(identity, committeeId);
  return Boolean(membershipRole);
}

module.exports = {
  canAssignTask,
  canReadCommittee,
  canUpdateTaskStatus,
  getMembershipRoleForCommittee,
  isGlobalAccess,
};
