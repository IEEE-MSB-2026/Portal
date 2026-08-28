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
  'visitor',
  'applicant',
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

function canManageTask({ identity, membershipRole }) {
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

  const taskAssigneeId = task.assignee_user_id || task.assignee_user_ref_id || task.assigneeUserId;
  const currentUserId = identity.userId || identity.userRefId || identity.externalUserId;

  if (
    taskAssigneeId &&
    (taskAssigneeId === currentUserId ||
     taskAssigneeId === identity.userRefId ||
     taskAssigneeId === identity.userRef?.id ||
     taskAssigneeId === identity.userRef?.externalUserId)
  ) {
    return { allowed: true, mode: 'own' };
  }

  return { allowed: false, mode: 'none' };
}

async function getMembershipRoleForCommittee(identity, committeeId) {
  if (isPrivilegedGlobalAccess(identity)) return identity.role;

  if (identity.scopeType === 'committee' && identity.scopeId !== committeeId) {
    return null;
  }

  if (identity.scopeType === 'committee' && identity.scopeId === committeeId && identity.role) {
    return identity.role;
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

function canManagePrCommittee({ identity, membershipRole, committeeId = null }) {
  if (isPrivilegedGlobalAccess(identity)) return true;

  if (identity.role === 'publisher') {
    if (identity.scopeType === 'global') return true;
    if (identity.scopeType === 'committee') {
      if (!committeeId) return true;
      return identity.scopeId === committeeId;
    }
  }

  return membershipRole === 'lead';
}

function canAcceptHrApplication({ identity, membershipRole, governanceMode }) {
  if (governanceMode === 'mode_a') {
    return canManageHrCommittee({ identity, membershipRole });
  }

  return isPrivilegedGlobalAccess(identity);
}

async function listManageableHrCommitteeIds(identity) {
  if (isPrivilegedGlobalAccess(identity)) return null;
  if (!identity?.userRefId) return [];

  if (identity.scopeType === 'committee') {
    const membershipRole = await getMembershipRoleForCommittee(identity, identity.scopeId);
    const canManage = canManageHrCommittee({ identity, membershipRole });
    return canManage ? [identity.scopeId] : [];
  }

  return committeesRepository.listCommitteeIdsForUserRole(identity.userRefId, 'lead');
}

async function listManageablePrCommitteeIds(identity) {
  if (isPrivilegedGlobalAccess(identity)) return null;

  if (identity.role === 'publisher') {
    if (identity.scopeType === 'global') return null;
    if (identity.scopeType === 'committee') return [identity.scopeId];
  }

  if (!identity?.userRefId) return [];

  if (identity.scopeType === 'committee') {
    const membershipRole = await getMembershipRoleForCommittee(identity, identity.scopeId);
    const canManage = canManagePrCommittee({
      identity,
      membershipRole,
      committeeId: identity.scopeId,
    });
    return canManage ? [identity.scopeId] : [];
  }

  return committeesRepository.listCommitteeIdsForUserRole(identity.userRefId, 'lead');
}

function canManageMediaCommittee({ identity, membershipRole, committeeId = null }) {
  return canManagePrCommittee({ identity, membershipRole, committeeId });
}

function canPublishMediaAlbum({ identity, committeeId }) {
  if (!['admin', 'publisher'].includes(identity.role)) return false;
  if (identity.scopeType === 'global') return true;
  if (identity.scopeType === 'committee') return identity.scopeId === committeeId;
  return false;
}

async function listManageableMediaCommitteeIds(identity) {
  return listManageablePrCommitteeIds(identity);
}

module.exports = {
  canAcceptHrApplication,
  canAssignTask,
  canManageTask,
  canManageHrCommittee,
  canManageMediaCommittee,
  canManagePrCommittee,
  canManageCommitteeContent,
  canManageMemberships,
  canPublishMediaAlbum,
  canReadCommittee,
  canSubmitHrApplication,
  canUpdateTaskStatus,
  getMembershipRoleForCommittee,
  isGlobalAccess,
  isPrivilegedGlobalAccess,
  listManageableHrCommitteeIds,
  listManageableMediaCommitteeIds,
  listManageablePrCommitteeIds,
};
