const { query } = require('../db/pool');

async function getCommitteeById(committeeId) {
  const result = await query(
    'SELECT id, slug, name, is_active FROM committees WHERE id = $1',
    [committeeId]
  );
  return result.rows[0] || null;
}

async function listCommitteesForUser(userRefId) {
  const result = await query(
    `
      SELECT c.id, c.slug, c.name, c.is_active, cm.role_in_committee
      FROM committee_memberships cm
      JOIN committees c ON c.id = cm.committee_id
      WHERE cm.user_ref_id = $1
      ORDER BY c.name ASC
    `,
    [userRefId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isActive: row.is_active,
    roleInCommittee: row.role_in_committee,
  }));
}

async function getMembershipRole(userRefId, committeeId) {
  const result = await query(
    `
      SELECT role_in_committee
      FROM committee_memberships
      WHERE user_ref_id = $1 AND committee_id = $2
    `,
    [userRefId, committeeId]
  );

  return result.rows[0]?.role_in_committee || null;
}

async function isMemberOfCommittee(userRefId, committeeId) {
  const role = await getMembershipRole(userRefId, committeeId);
  return Boolean(role);
}

async function listCommitteeIdsForUserRole(userRefId, roleInCommittee) {
  const result = await query(
    `
      SELECT committee_id
      FROM committee_memberships
      WHERE user_ref_id = $1 AND role_in_committee = $2
      ORDER BY committee_id ASC
    `,
    [userRefId, roleInCommittee]
  );

  return result.rows.map((row) => row.committee_id);
}

module.exports = {
  getCommitteeById,
  getMembershipRole,
  isMemberOfCommittee,
  listCommitteeIdsForUserRole,
  listCommitteesForUser,
};
