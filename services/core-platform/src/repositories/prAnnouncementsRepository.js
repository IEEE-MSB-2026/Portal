const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapAnnouncementColumns(prefix = 'a') {
  return `
    ${prefix}.id,
    ${prefix}.committee_id,
    ${prefix}.title,
    ${prefix}.body,
    ${prefix}.visibility,
    ${prefix}.created_by_user_ref_id,
    ${prefix}.updated_by_user_ref_id,
    ${prefix}.deleted_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at,
    ${prefix}.deleted_at
  `;
}

function mapAnnouncementSelect(prefix = 'a') {
  return `
    ${mapAnnouncementColumns(prefix)},
    c.name AS committee_name,
    creator.external_user_id AS created_by_external_user_id,
    updater.external_user_id AS updated_by_external_user_id,
    deleter.external_user_id AS deleted_by_external_user_id
  `;
}

async function getAnnouncementById(announcementId, { includeDeleted = false } = {}) {
  const values = [announcementId];
  const deletedClause = includeDeleted ? '' : 'AND a.deleted_at IS NULL';

  const result = await query(
    `
      SELECT
        ${mapAnnouncementSelect('a')}
      FROM pr_announcements a
      JOIN committees c ON c.id = a.committee_id
      JOIN users_ref creator ON creator.id = a.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = a.updated_by_user_ref_id
      LEFT JOIN users_ref deleter ON deleter.id = a.deleted_by_user_ref_id
      WHERE a.id = $1
      ${deletedClause}
      LIMIT 1
    `,
    values
  );

  return result.rows[0] || null;
}

async function createAnnouncement({
  committeeId,
  title,
  body,
  visibility,
  actorUserRefId,
}) {
  const announcementId = randomUUID();
  await query(
    `
      INSERT INTO pr_announcements (
        id,
        committee_id,
        title,
        body,
        visibility,
        created_by_user_ref_id,
        updated_by_user_ref_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `,
    [announcementId, committeeId, title, body, visibility, actorUserRefId]
  );

  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function updateAnnouncement({
  announcementId,
  title,
  body,
  visibility,
  actorUserRefId,
}) {
  const result = await query(
    `
      UPDATE pr_announcements
      SET
        title = $2,
        body = $3,
        visibility = $4,
        updated_by_user_ref_id = $5,
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `,
    [announcementId, title, body, visibility, actorUserRefId]
  );

  if (!result.rows[0]) return null;
  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function softDeleteAnnouncement({ announcementId, actorUserRefId }) {
  const result = await query(
    `
      UPDATE pr_announcements
      SET
        deleted_at = NOW(),
        deleted_by_user_ref_id = $2,
        updated_by_user_ref_id = $2,
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `,
    [announcementId, actorUserRefId]
  );

  if (!result.rows[0]) return null;
  return getAnnouncementById(announcementId, { includeDeleted: true });
}

async function listAnnouncements({
  committeeId = null,
  committeeIds = null,
  visibility = null,
  includeDeleted = false,
  limit = 50,
}) {
  const values = [limit];
  const where = [];

  if (!includeDeleted) {
    where.push('a.deleted_at IS NULL');
  }

  if (committeeId) {
    values.push(committeeId);
    where.push(`a.committee_id = $${values.length}`);
  } else if (Array.isArray(committeeIds)) {
    if (!committeeIds.length) return [];
    const placeholders = committeeIds.map((_, index) => `$${values.length + index + 1}`);
    values.push(...committeeIds);
    where.push(`a.committee_id IN (${placeholders.join(', ')})`);
  }

  if (visibility) {
    values.push(visibility);
    where.push(`a.visibility = $${values.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapAnnouncementSelect('a')}
      FROM pr_announcements a
      JOIN committees c ON c.id = a.committee_id
      JOIN users_ref creator ON creator.id = a.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = a.updated_by_user_ref_id
      LEFT JOIN users_ref deleter ON deleter.id = a.deleted_by_user_ref_id
      ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1
    `,
    values
  );

  return result.rows;
}

async function createActivity({ announcementId, action, actorUserRefId, metadata }) {
  await query(
    `
      INSERT INTO pr_announcement_activity_log (
        id,
        announcement_id,
        action,
        actor_user_ref_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [randomUUID(), announcementId, action, actorUserRefId, JSON.stringify(metadata || {})]
  );
}

module.exports = {
  createActivity,
  createAnnouncement,
  getAnnouncementById,
  listAnnouncements,
  softDeleteAnnouncement,
  updateAnnouncement,
};
