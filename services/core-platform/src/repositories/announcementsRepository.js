const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createAnnouncement({ committeeId, title, body, createdByUserRefId }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO committee_announcements (id, committee_id, title, body, created_by_user_ref_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, committee_id, title, body, created_at
    `,
    [id, committeeId, title, body, createdByUserRefId]
  );

  return result.rows[0];
}

async function listAnnouncementsByCommittee(committeeId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT id, committee_id, title, body, created_at
      FROM committee_announcements
      WHERE committee_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [committeeId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  }));
}

async function listRecentAnnouncementsForUserCommittees(userRefId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT ca.id, ca.committee_id, c.slug AS committee_slug, c.name AS committee_name, ca.title, ca.body, ca.created_at
      FROM committee_announcements ca
      JOIN committee_memberships cm ON cm.committee_id = ca.committee_id
      JOIN committees c ON c.id = ca.committee_id
      WHERE cm.user_ref_id = $1
      ORDER BY ca.created_at DESC
      LIMIT $2
    `,
    [userRefId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    committeeSlug: row.committee_slug,
    committeeName: row.committee_name,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  }));
}

module.exports = {
  createAnnouncement,
  listAnnouncementsByCommittee,
  listRecentAnnouncementsForUserCommittees,
};
