const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

const ALLOWED_ROLES = new Set(['member', 'lead', 'hr']);

function assertRole(role) {
  if (!ALLOWED_ROLES.has(role)) {
    const error = new Error('Invalid committee role');
    error.status = 400;
    throw error;
  }
}

async function upsertMembership({ committeeId, userId, userRefId, roleInCommittee }) {
  assertRole(roleInCommittee);
  const targetUserId = userId || userRefId;
  const id = randomUUID();

  const result = await query(
    `
      INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (committee_id, user_id)
      DO UPDATE SET role_in_committee = EXCLUDED.role_in_committee
      RETURNING id, committee_id, user_id, role_in_committee
    `,
    [id, committeeId, targetUserId, roleInCommittee]
  );

  return {
    id: result.rows[0].id,
    committeeId: result.rows[0].committee_id,
    userId: result.rows[0].user_id,
    userRefId: result.rows[0].user_id,
    roleInCommittee: result.rows[0].role_in_committee,
  };
}

async function deleteMembership({ committeeId, userId, userRefId }) {
  const targetUserId = userId || userRefId;
  const result = await query(
    `
      DELETE FROM committee_memberships
      WHERE committee_id = $1 AND user_id = $2
      RETURNING id, committee_id, user_id, role_in_committee
    `,
    [committeeId, targetUserId]
  );

  if (!result.rows[0]) return null;
  return {
    id: result.rows[0].id,
    committeeId: result.rows[0].committee_id,
    userId: result.rows[0].user_id,
    userRefId: result.rows[0].user_id,
    roleInCommittee: result.rows[0].role_in_committee,
  };
}

async function listMembershipsByCommittee(committeeId) {
  const result = await query(
    `
      SELECT cm.id, cm.committee_id, cm.user_id, cm.role_in_committee, u.id AS external_user_id, u.name, u.email, u.avatar_url, u.membership_id
      FROM committee_memberships cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.committee_id = $1
      ORDER BY cm.role_in_committee DESC, u.name ASC
    `,
    [committeeId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    userId: row.user_id,
    userRefId: row.user_id,
    externalUserId: row.external_user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    membershipId: row.membership_id,
    roleInCommittee: row.role_in_committee,
  }));
}

async function searchCommitteeMembers(committeeId, { search, id } = {}) {
  const values = [committeeId];
  let filterClause = '';
  let idx = 2;

  if (id) {
    values.push(id);
    filterClause += ` AND (u.id = $${idx}::uuid OR cm.id = $${idx}::uuid)`;
    idx++;
  } else if (search) {
    values.push(`%${search.trim().toLowerCase()}%`);
    filterClause += ` AND (LOWER(u.name) LIKE $${idx} OR LOWER(u.email) LIKE $${idx} OR LOWER(cm.role_in_committee::text) LIKE $${idx})`;
    idx++;
  }

  const result = await query(
    `
      SELECT cm.id, cm.committee_id, cm.user_id, cm.role_in_committee, u.id AS external_user_id, u.name, u.email, u.avatar_url, u.membership_id
      FROM committee_memberships cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.committee_id = $1
      ${filterClause}
      ORDER BY cm.role_in_committee DESC, u.name ASC
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    userId: row.user_id,
    userRefId: row.user_id,
    externalUserId: row.external_user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    membershipId: row.membership_id,
    roleInCommittee: row.role_in_committee,
  }));
}

async function countLeadsInCommittee(committeeId) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS c
      FROM committee_memberships
      WHERE committee_id = $1 AND role_in_committee = 'lead'
    `,
    [committeeId]
  );

  return result.rows[0]?.c || 0;
}

async function listAllMemberships() {
  const result = await query(
    `
      SELECT cm.id, cm.committee_id, c.name AS committee_name, c.slug AS committee_slug,
             cm.user_id, cm.role_in_committee, cm.created_at,
             u.id AS external_user_id, u.name, u.email, u.avatar_url, u.membership_id
      FROM committee_memberships cm
      JOIN users u ON u.id = cm.user_id
      JOIN committees c ON c.id = cm.committee_id
      ORDER BY c.name ASC, cm.role_in_committee DESC, u.name ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    committeeSlug: row.committee_slug,
    userId: row.user_id,
    userRefId: row.user_id,
    externalUserId: row.external_user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    membershipId: row.membership_id,
    roleInCommittee: row.role_in_committee,
    createdAt: row.created_at,
  }));
}

module.exports = {
  countLeadsInCommittee,
  deleteMembership,
  listAllMemberships,
  listMembershipsByCommittee,
  searchCommitteeMembers,
  upsertMembership,
};
