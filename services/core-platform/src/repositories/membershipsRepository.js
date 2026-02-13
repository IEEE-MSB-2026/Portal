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

async function upsertMembership({ committeeId, userRefId, roleInCommittee }) {
  assertRole(roleInCommittee);
  const id = randomUUID();

  const result = await query(
    `
      INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (committee_id, user_ref_id)
      DO UPDATE SET role_in_committee = EXCLUDED.role_in_committee
      RETURNING id, committee_id, user_ref_id, role_in_committee
    `,
    [id, committeeId, userRefId, roleInCommittee]
  );

  return result.rows[0];
}

async function deleteMembership({ committeeId, userRefId }) {
  const result = await query(
    `
      DELETE FROM committee_memberships
      WHERE committee_id = $1 AND user_ref_id = $2
      RETURNING id, committee_id, user_ref_id, role_in_committee
    `,
    [committeeId, userRefId]
  );

  return result.rows[0] || null;
}

async function listMembershipsByCommittee(committeeId) {
  const result = await query(
    `
      SELECT cm.id, cm.committee_id, cm.user_ref_id, cm.role_in_committee, ur.external_user_id, ur.email
      FROM committee_memberships cm
      JOIN users_ref ur ON ur.id = cm.user_ref_id
      WHERE cm.committee_id = $1
      ORDER BY cm.role_in_committee DESC, ur.external_user_id ASC
    `,
    [committeeId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    userRefId: row.user_ref_id,
    externalUserId: row.external_user_id,
    email: row.email,
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
