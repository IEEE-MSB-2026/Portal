const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

const ALLOWED_ROLES = new Set(['member', 'lead']);

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

module.exports = {
  countLeadsInCommittee,
  deleteMembership,
  listMembershipsByCommittee,
  upsertMembership,
};
