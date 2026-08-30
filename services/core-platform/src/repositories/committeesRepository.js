const { query } = require('../db/pool');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCommitteeById(committeeId) {
  if (!committeeId || typeof committeeId !== 'string' || !UUID_REGEX.test(committeeId)) {
    return null;
  }
  const result = await query(
    'SELECT id, slug, name, is_active FROM committees WHERE id = $1',
    [committeeId]
  );
  return result.rows[0] || null;
}

async function getCommitteeBySlug(slug) {
  const result = await query(
    'SELECT id, slug, name, is_active FROM committees WHERE slug = $1 LIMIT 1',
    [slug]
  );
  return result.rows[0] || null;
}

async function listCommitteesForUser(userId) {
  const result = await query(
    `
      SELECT c.id, c.slug, c.name, c.is_active, cm.role_in_committee
      FROM committee_memberships cm
      JOIN committees c ON c.id = cm.committee_id
      WHERE cm.user_id = $1
      ORDER BY c.name ASC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isActive: row.is_active,
    roleInCommittee: row.role_in_committee,
  }));
}

async function getMembershipRole(userId, committeeId) {
  const result = await query(
    `
      SELECT role_in_committee
      FROM committee_memberships
      WHERE user_id = $1 AND committee_id = $2
    `,
    [userId, committeeId]
  );

  return result.rows[0]?.role_in_committee || null;
}

async function isMemberOfCommittee(userId, committeeId) {
  const role = await getMembershipRole(userId, committeeId);
  return Boolean(role);
}

async function listCommitteeIdsForUserRole(userId, roleInCommittee) {
  const result = await query(
    `
      SELECT committee_id
      FROM committee_memberships
      WHERE user_id = $1 AND role_in_committee = $2
      ORDER BY committee_id ASC
    `,
    [userId, roleInCommittee]
  );

  return result.rows.map((row) => row.committee_id);
}

async function listPublicCommittees() {
  const result = await query(
    'SELECT id, slug, name, is_active FROM committees WHERE is_active = TRUE ORDER BY name ASC'
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isActive: row.is_active,
  }));
}

module.exports = {
  getCommitteeById,
  getCommitteeBySlug,
  getMembershipRole,
  isMemberOfCommittee,
  listCommitteeIdsForUserRole,
  listCommitteesForUser,
  listPublicCommittees,
};
