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
  if (!identity) return false;
  if (identity.scopeType === 'global' && PRIVILEGED_GLOBAL_ROLES.has(identity.role)) return true;
  if (PRIVILEGED_GLOBAL_ROLES.has(identity.userRef?.defaultRole) || PRIVILEGED_GLOBAL_ROLES.has(identity.role)) return true;
  return false;
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
  return membershipRole === 'lead' || membershipRole === 'hr';
}

function canDeleteCommitteeContent({ identity, membershipRole }) {
  if (isGlobalAccess(identity)) return true;
  return membershipRole === 'lead';
}

async function canManageMemberships({ identity, membershipRole }) {
  if (isGlobalAccess(identity)) return true;
  if (await isHrCommitteeLead(identity)) return true;
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

  if (identity.scopeType === 'committee' && identity.scopeId === committeeId && identity.role) {
    return identity.role;
  }

  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (currentUserId) {
    const role = await committeesRepository.getMembershipRole(currentUserId, committeeId);
    if (role) return role;
  }

  if (await isHrCommitteeLead(identity)) {
    return 'hr';
  }

  return null;
}

async function canReadCommittee(identity, committeeId) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (await isHrCommitteeLead(identity)) return true;
  const membershipRole = await getMembershipRoleForCommittee(identity, committeeId);
  return Boolean(membershipRole);
}

async function isHrCommitteeLead(identity) {
  if (!identity) return false;
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (identity.scopeType === 'committee' && identity.scopeId && identity.role === 'lead') {
    const committee = await committeesRepository.getCommitteeById(identity.scopeId);
    if (committee?.slug === 'hr') return true;
  }
  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (currentUserId) {
    const hrCommittee = await committeesRepository.getCommitteeBySlug('hr');
    if (hrCommittee) {
      const role = await committeesRepository.getMembershipRole(currentUserId, hrCommittee.id);
      if (role === 'lead') return true;
    }
  }
  return false;
}

async function canManageHrCommittee({ identity, membershipRole }) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (await isHrCommitteeLead(identity)) return true;
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

function canPromoteOrDemoteLead(identity) {
  return isPrivilegedGlobalAccess(identity);
}

async function canAcceptHrApplication({ identity, membershipRole, governanceMode }) {
  if (governanceMode === 'mode_a') {
    return (await canManageHrCommittee({ identity, membershipRole })) || (await isHrCommitteeLead(identity));
  }

  if (governanceMode === 'mode_b') {
    return isPrivilegedGlobalAccess(identity);
  }

  if (await isHrCommitteeLead(identity)) return true;
  return isPrivilegedGlobalAccess(identity);
}

async function listManageableHrCommitteeIds(identity) {
  if (isPrivilegedGlobalAccess(identity)) return null;
  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (!currentUserId) return [];

  if (identity.scopeType === 'committee') {
    const membershipRole = await getMembershipRoleForCommittee(identity, identity.scopeId);
    const canManage = await canManageHrCommittee({ identity, membershipRole });
    return canManage ? [identity.scopeId] : [];
  }

  return committeesRepository.listCommitteeIdsForUserRole(currentUserId, 'lead');
}

async function listManageablePrCommitteeIds(identity) {
  if (isPrivilegedGlobalAccess(identity)) return null;

  if (identity.role === 'publisher') {
    if (identity.scopeType === 'global') return null;
    if (identity.scopeType === 'committee') return [identity.scopeId];
  }

  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (!currentUserId) return [];

  if (identity.scopeType === 'committee') {
    const membershipRole = await getMembershipRoleForCommittee(identity, identity.scopeId);
    const canManage = canManagePrCommittee({
      identity,
      membershipRole,
      committeeId: identity.scopeId,
    });
    return canManage ? [identity.scopeId] : [];
  }

  return committeesRepository.listCommitteeIdsForUserRole(currentUserId, 'lead');
}

async function isMediaCommitteeLead(identity) {
  if (!identity) return false;
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (identity.scopeType === 'committee' && identity.scopeId && identity.role === 'lead') {
    const committee = await committeesRepository.getCommitteeById(identity.scopeId);
    if (committee?.slug === 'media') return true;
  }
  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (currentUserId) {
    const mediaCommittee = await committeesRepository.getCommitteeBySlug('media');
    if (mediaCommittee) {
      const role = await committeesRepository.getMembershipRole(currentUserId, mediaCommittee.id);
      if (role === 'lead') return true;
    }
  }
  return false;
}

async function canManageMediaCommittee({ identity, membershipRole, committeeId = null }) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (identity?.role === 'lead') return true;
  if (await isMediaCommitteeLead(identity)) return true;
  return canManagePrCommittee({ identity, membershipRole, committeeId });
}

async function canPublishMediaAlbum({ identity, committeeId, membershipRole = null }) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (['admin', 'publisher'].includes(identity.role)) {
    if (identity.scopeType === 'global') return true;
    if (identity.scopeType === 'committee') return !committeeId || identity.scopeId === committeeId;
  }
  if (await isMediaCommitteeLead(identity)) return true;
  return false;
}

async function isOperationsCommitteeLead(identity) {
  if (!identity) return false;
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (identity.scopeType === 'committee' && identity.scopeId && identity.role === 'lead') {
    const committee = await committeesRepository.getCommitteeById(identity.scopeId);
    if (committee?.slug === 'oc' || committee?.slug === 'operations') return true;
  }
  const currentUserId = identity?.userRefId || identity?.userId || identity?.externalUserId;
  if (currentUserId) {
    const ocCommittee = (await committeesRepository.getCommitteeBySlug('oc')) || (await committeesRepository.getCommitteeBySlug('operations'));
    if (ocCommittee) {
      const role = await committeesRepository.getMembershipRole(currentUserId, ocCommittee.id);
      if (role === 'lead') return true;
    }
  }
  return false;
}

async function canManageOperations({ identity, membershipRole = null }) {
  if (isPrivilegedGlobalAccess(identity)) return true;
  if (await isOperationsCommitteeLead(identity)) return true;
  return membershipRole === 'lead';
}

async function listManageableMediaCommitteeIds(identity) {
  if (isPrivilegedGlobalAccess(identity) || (await isMediaCommitteeLead(identity))) return null;
  return listManageablePrCommitteeIds(identity);
}

module.exports = {
  canAcceptHrApplication,
  canAssignTask,
  canManageTask,
  canManageHrCommittee,
  canManageMediaCommittee,
  canManageOperations,
  canManagePrCommittee,
  canManageCommitteeContent,
  canDeleteCommitteeContent,
  canManageMemberships,
  canPromoteOrDemoteLead,
  canPublishMediaAlbum,
  canReadCommittee,
  canSubmitHrApplication,
  canUpdateTaskStatus,
  getMembershipRoleForCommittee,
  isGlobalAccess,
  isHrCommitteeLead,
  isMediaCommitteeLead,
  isOperationsCommitteeLead,
  isPrivilegedGlobalAccess,
  listManageableHrCommitteeIds,
  listManageableMediaCommitteeIds,
  listManageablePrCommitteeIds,
};
