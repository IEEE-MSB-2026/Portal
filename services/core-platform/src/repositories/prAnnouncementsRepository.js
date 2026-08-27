const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

const ALLOWED_CATEGORIES = new Set(['General', 'Event', 'Recruitment', 'Technical', 'Opportunity']);

function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'string') return 'General';
  const trimmed = raw.trim();
  const matched = Array.from(ALLOWED_CATEGORIES).find(
    (c) => c.toLowerCase() === trimmed.toLowerCase()
  );
  return matched || 'General';
}

function mapAnnouncementColumns(prefix = 'a') {
  return `
    ${prefix}.id,
    ${prefix}.title,
    ${prefix}.body,
    ${prefix}.category,
    ${prefix}.image_url,
    ${prefix}.is_pinned,
    ${prefix}.visibility,
    ${prefix}.author_user_id,
    ${prefix}.author_user_id AS created_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at,
    ${prefix}.deleted_at,
    creator.name AS author_name,
    creator.id AS created_by_external_user_id
  `;
}

async function getAnnouncementById(announcementId, { includeDeleted = false } = {}) {
  const deletedClause = includeDeleted ? '' : 'AND a.deleted_at IS NULL';
  const result = await query(
    `
      SELECT
        ${mapAnnouncementColumns('a')}
      FROM pr_announcements a
      JOIN users creator ON creator.id = a.author_user_id
      WHERE a.id = $1 ${deletedClause}
      LIMIT 1
    `,
    [announcementId]
  );

  return result.rows[0] || null;
}

async function createAnnouncement({
  title,
  body,
  category = 'General',
  imageUrl = null,
  isPinned = false,
  visibility = 'public',
  authorUserId,
  actorUserId,
  actorUserRefId,
}) {
  const announcementId = randomUUID();
  const normalizedCategory = normalizeCategory(category);
  const targetAuthorId = authorUserId || actorUserId || actorUserRefId;

  await query(
    `
      INSERT INTO pr_announcements (
        id,
        title,
        body,
        category,
        image_url,
        is_pinned,
        visibility,
        author_user_id,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    `,
    [
      announcementId,
      title.trim(),
      body.trim(),
      normalizedCategory,
      imageUrl || null,
      Boolean(isPinned),
      visibility,
      targetAuthorId,
    ]
  );

  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function updateAnnouncement({
  announcementId,
  title,
  body,
  category,
  imageUrl = null,
  isPinned,
  visibility,
}) {
  const updates = [];
  const values = [announcementId];

  if (title !== undefined && title !== null) {
    values.push(title.trim());
    updates.push(`title = $${values.length}`);
  }

  if (body !== undefined && body !== null) {
    values.push(body.trim());
    updates.push(`body = $${values.length}`);
  }

  if (category !== undefined && category !== null) {
    values.push(normalizeCategory(category));
    updates.push(`category = $${values.length}`);
  }

  if (imageUrl !== undefined) {
    values.push(imageUrl || null);
    updates.push(`image_url = $${values.length}`);
  }

  if (isPinned !== undefined && isPinned !== null) {
    values.push(Boolean(isPinned));
    updates.push(`is_pinned = $${values.length}`);
  }

  if (visibility !== undefined && visibility !== null) {
    values.push(visibility);
    updates.push(`visibility = $${values.length}`);
  }

  updates.push(`updated_at = NOW()`);

  const result = await query(
    `
      UPDATE pr_announcements
      SET ${updates.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `,
    values
  );

  if (!result.rows[0]) return null;
  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function softDeleteAnnouncement({ announcementId, actorUserId, actorUserRefId }) {
  const result = await query(
    `
      UPDATE pr_announcements
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `,
    [announcementId]
  );

  if (!result.rows[0]) return null;
  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function listAnnouncements({
  category = null,
  search = null,
  visibility = null,
  includeDeleted = false,
  limit = 50,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (category && typeof category === 'string' && category.trim() && category.trim().toLowerCase() !== 'all') {
    values.push(normalizeCategory(category));
    where.push(`a.category = $${values.length}`);
  }

  if (search && typeof search === 'string' && search.trim()) {
    values.push(`%${search.trim()}%`);
    where.push(`(a.title ILIKE $${values.length} OR a.body ILIKE $${values.length})`);
  }

  if (visibility) {
    values.push(visibility);
    where.push(`a.visibility = $${values.length}`);
  }

  if (!includeDeleted) {
    where.push('a.deleted_at IS NULL');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const queryText = `
    SELECT
      ${mapAnnouncementColumns('a')}
    FROM pr_announcements a
    JOIN users creator ON creator.id = a.author_user_id
    ${whereClause}
    ORDER BY a.is_pinned DESC, a.created_at DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await query(queryText, values);
  return result.rows;
}

async function createActivityLog({
  announcementId,
  action,
  actorUserId,
  actorUserRefId,
  metadata = {},
}) {
  const logId = randomUUID();
  const actorId = actorUserId || actorUserRefId;
  await query(
    `
      INSERT INTO pr_announcement_activity_log (
        id,
        announcement_id,
        action,
        actor_user_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [logId, announcementId, action, actorId, JSON.stringify(metadata)]
  );
  return true;
}

module.exports = {
  ALLOWED_CATEGORIES: Array.from(ALLOWED_CATEGORIES),
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  softDeleteAnnouncement,
  listAnnouncements,
  createActivityLog,
};
