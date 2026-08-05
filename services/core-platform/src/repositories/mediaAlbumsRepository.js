const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapAlbumColumns(prefix = 'a') {
  return `
    ${prefix}.id,
    ${prefix}.committee_id,
    ${prefix}.title,
    ${prefix}.description,
    ${prefix}.status,
    ${prefix}.published_at,
    ${prefix}.created_by_user_ref_id,
    ${prefix}.updated_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at
  `;
}

function mapAlbumSelect(prefix = 'a') {
  return `
    ${mapAlbumColumns(prefix)},
    c.name AS committee_name,
    creator.external_user_id AS created_by_external_user_id,
    updater.external_user_id AS updated_by_external_user_id
  `;
}

async function getAlbumById(albumId) {
  const result = await query(
    `
      SELECT
        ${mapAlbumSelect('a')}
      FROM media_albums a
      JOIN committees c ON c.id = a.committee_id
      JOIN users_ref creator ON creator.id = a.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = a.updated_by_user_ref_id
      WHERE a.id = $1
      LIMIT 1
    `,
    [albumId]
  );
  return result.rows[0] || null;
}

async function createAlbum({ committeeId, title, description, actorUserRefId }) {
  const albumId = randomUUID();
  await query(
    `
      INSERT INTO media_albums (
        id,
        committee_id,
        title,
        description,
        status,
        created_by_user_ref_id,
        updated_by_user_ref_id
      )
      VALUES ($1, $2, $3, $4, 'draft', $5, $5)
    `,
    [albumId, committeeId, title, description || null, actorUserRefId]
  );

  return getAlbumById(albumId);
}

async function listAlbums({ committeeId = null, committeeIds = null, limit = 50 }) {
  const values = [limit];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`a.committee_id = $${values.length}`);
  } else if (Array.isArray(committeeIds)) {
    if (!committeeIds.length) return [];
    const placeholders = committeeIds.map((_, index) => `$${values.length + index + 1}`);
    values.push(...committeeIds);
    where.push(`a.committee_id IN (${placeholders.join(', ')})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await query(
    `
      SELECT
        ${mapAlbumSelect('a')}
      FROM media_albums a
      JOIN committees c ON c.id = a.committee_id
      JOIN users_ref creator ON creator.id = a.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = a.updated_by_user_ref_id
      ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1
    `,
    values
  );

  return result.rows;
}

async function addAlbumAsset({ albumId, assetUrl, assetType, caption, actorUserRefId }) {
  const result = await query(
    `
      INSERT INTO media_album_assets (
        id,
        album_id,
        asset_url,
        asset_type,
        caption,
        created_by_user_ref_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        album_id,
        asset_url,
        asset_type,
        caption,
        created_by_user_ref_id,
        created_at
    `,
    [randomUUID(), albumId, assetUrl, assetType, caption || null, actorUserRefId]
  );

  return result.rows[0];
}

async function listAlbumAssets(albumId, { limit = 200 } = {}) {
  const result = await query(
    `
      SELECT
        a.id,
        a.album_id,
        a.asset_url,
        a.asset_type,
        a.caption,
        a.created_by_user_ref_id,
        creator.external_user_id AS created_by_external_user_id,
        a.created_at
      FROM media_album_assets a
      JOIN users_ref creator ON creator.id = a.created_by_user_ref_id
      WHERE a.album_id = $1
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT $2
    `,
    [albumId, limit]
  );

  return result.rows;
}

async function publishAlbum({ albumId, actorUserRefId }) {
  const result = await query(
    `
      UPDATE media_albums
      SET
        status = 'published',
        published_at = COALESCE(published_at, NOW()),
        updated_by_user_ref_id = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [albumId, actorUserRefId]
  );

  if (!result.rows[0]) return null;
  return getAlbumById(albumId);
}

module.exports = {
  addAlbumAsset,
  createAlbum,
  getAlbumById,
  listAlbumAssets,
  listAlbums,
  publishAlbum,
};
