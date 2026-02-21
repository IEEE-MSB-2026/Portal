const committeesRepository = require('../repositories/committeesRepository');

const PRIVILEGED_GLOBAL_ROLES = new Set(['admin', 'officer']);
const APPLICANT_ROLES = new Set([
  'admin',
  'officer',
  'lead',
  'member',
  'editor',
  'publisher',
  'event_organizer',
  'event_scanner',
]);

function isPrivilegedGlobalAccess(identity) {
  return identity.scopeType === 'global' && PRIVILEGED_GLOBAL_ROLES.has(identity.role);
}

function isGlobalAccess(identity) {
  return isPrivilegedGlobalAccess(identity);
}

function canAssignTask({ identity, membershipRole }) {
  if (isGlobalAccess(identity)) return true;
  return membershipRole === 'lead';
}

function canManageCommitteeContent({ identity, membershipRole }) {
  if (isGlobalAccess(identity)) return true;
  return membershipRole === 'lead';
}

function canManageMemberships({ identity, membershipRole }) {
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
  if (isPrivilegedGlobalAccess(identity)) return identity.role;

  if (identity.scopeType === 'committee' && identity.scopeId !== committeeId) {
    return null;
  }

  return committeesRepository.getMembershipRole(identity.userRefId, committeeId);
}

async function canReadCommittee(identity, committeeId) {
  const membershipRole = await getMembershipRoleForCommittee(identity, committeeId);
  return Boolean(membershipRole);
}

function canManageHrCommittee({ identity, membershipRole }) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  return membershipRole === 'lead';
}

function canSubmitHrApplication(identity) {
  return APPLICANT_ROLES.has(identity.role);
}

module.exports = {
  canAssignTask,
  canManageHrCommittee,
  canManageCommitteeContent,
  canManageMemberships,
  canReadCommittee,
  canSubmitHrApplication,
  canUpdateTaskStatus,
  getMembershipRoleForCommittee,
  isGlobalAccess,
  isPrivilegedGlobalAccess,
};
