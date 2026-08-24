const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createAnnouncement({ committeeId, title, body, imageUrl = null, createdByUserRefId }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO committee_announcements (id, committee_id, title, body, image_url, created_by_user_ref_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, committee_id, title, body, image_url, created_at
    `,
    [id, committeeId, title, body, imageUrl || null, createdByUserRefId]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url || null,
    createdAt: row.created_at,
  };
}

async function listAnnouncementsByCommittee(committeeId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT id, committee_id, title, body, image_url, created_at
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
    imageUrl: row.image_url || null,
    createdAt: row.created_at,
  }));
}

async function listRecentAnnouncementsForUserCommittees(userRefId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT ca.id, ca.committee_id, c.slug AS committee_slug, c.name AS committee_name, ca.title, ca.body, ca.image_url, ca.created_at
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
    imageUrl: row.image_url || null,
    createdAt: row.created_at,
  }));
}

module.exports = {
  createAnnouncement,
  listAnnouncementsByCommittee,
  listRecentAnnouncementsForUserCommittees,
};
