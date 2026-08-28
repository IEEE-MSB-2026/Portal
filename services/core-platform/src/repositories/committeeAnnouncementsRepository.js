const { query } = require('../db/pool');

async function createAnnouncement({
  committeeId,
  title,
  body,
  createdByUserId,
  isPinned = false,
}) {
  const result = await query(
    `
      INSERT INTO committee_announcements (
        committee_id,
        title,
        body,
        created_by_user_id,
        is_pinned
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [committeeId, title, body, createdByUserId, Boolean(isPinned)]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    body: row.body,
    createdByUserId: row.created_by_user_id,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listAnnouncementsByCommittee(committeeId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT
        ca.id,
        ca.committee_id,
        ca.title,
        ca.body,
        ca.is_pinned,
        ca.created_at,
        ca.updated_at,
        u.name AS author_name,
        u.email AS author_email,
        u.avatar_url AS author_avatar_url,
        c.name AS committee_name,
        c.slug AS committee_slug
      FROM committee_announcements ca
      LEFT JOIN users u ON u.id = ca.created_by_user_id
      LEFT JOIN committees c ON c.id = ca.committee_id
      WHERE ca.committee_id = $1 AND ca.deleted_at IS NULL
      ORDER BY ca.is_pinned DESC, ca.created_at DESC
      LIMIT $2
    `,
    [committeeId, limit]
  );

  return result.rows.map((r) => ({
    id: r.id,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    committeeSlug: r.committee_slug,
    title: r.title,
    body: r.body,
    isPinned: r.is_pinned,
    authorName: r.author_name || 'Committee Lead',
    authorEmail: r.author_email,
    authorAvatarUrl: r.author_avatar_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function listAnnouncementsForCommittees(committeeIds, { limit = 10 } = {}) {
  if (!committeeIds || committeeIds.length === 0) return [];

  const result = await query(
    `
      SELECT
        ca.id,
        ca.committee_id,
        ca.title,
        ca.body,
        ca.is_pinned,
        ca.created_at,
        ca.updated_at,
        u.name AS author_name,
        u.email AS author_email,
        u.avatar_url AS author_avatar_url,
        c.name AS committee_name,
        c.slug AS committee_slug
      FROM committee_announcements ca
      LEFT JOIN users u ON u.id = ca.created_by_user_id
      LEFT JOIN committees c ON c.id = ca.committee_id
      WHERE ca.committee_id = ANY($1) AND ca.deleted_at IS NULL
      ORDER BY ca.is_pinned DESC, ca.created_at DESC
      LIMIT $2
    `,
    [committeeIds, limit]
  );

  return result.rows.map((r) => ({
    id: r.id,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    committeeSlug: r.committee_slug,
    title: r.title,
    body: r.body,
    isPinned: r.is_pinned,
    authorName: r.author_name || 'Committee Lead',
    authorEmail: r.author_email,
    authorAvatarUrl: r.author_avatar_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function getAnnouncementById(announcementId) {
  const result = await query(
    `
      SELECT * FROM committee_announcements
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [announcementId]
  );
  return result.rows[0] || null;
}

async function deleteAnnouncement(announcementId) {
  const result = await query(
    `
      UPDATE committee_announcements
      SET deleted_at = NOW()
      WHERE id = $1
      RETURNING id, deleted_at
    `,
    [announcementId]
  );
  return result.rows[0] || null;
}

async function updateAnnouncementPin(announcementId, isPinned) {
  const result = await query(
    `
      UPDATE committee_announcements
      SET is_pinned = $2, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `,
    [announcementId, Boolean(isPinned)]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    body: row.body,
    createdByUserId: row.created_by_user_id,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createAnnouncement,
  listAnnouncementsByCommittee,
  listAnnouncementsForCommittees,
  getAnnouncementById,
  deleteAnnouncement,
  updateAnnouncementPin,
};
