const { randomUUID } = require('crypto');
const { query, getPool } = require('../db/pool');

function mapAlbumColumns(prefix = 'a') {
  return `
    ${prefix}.id,
    ${prefix}.committee_id,
    ${prefix}.title,
    ${prefix}.description,
    ${prefix}.cover_image_url,
    ${prefix}.status,
    ${prefix}.published_at,
    ${prefix}.created_by_user_id,
    ${prefix}.created_by_user_id AS created_by_user_ref_id,
    ${prefix}.updated_by_user_id,
    ${prefix}.updated_by_user_id AS updated_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at
  `;
}

function mapAlbumSelect(prefix = 'a') {
  return `
    ${mapAlbumColumns(prefix)},
    c.name AS committee_name,
    creator.id AS created_by_external_user_id,
    creator.name AS created_by_name,
    updater.id AS updated_by_external_user_id
  `;
}

async function countAlbumAssets(albumId) {
  const result = await query(
    'SELECT COUNT(*)::int AS count FROM media_album_assets WHERE album_id = $1',
    [albumId]
  );
  return result.rows[0]?.count || 0;
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
        a.created_by_user_id,
        a.created_by_user_id AS created_by_user_ref_id,
        creator.id AS created_by_external_user_id,
        a.created_at
      FROM media_album_assets a
      LEFT JOIN users creator ON creator.id = a.created_by_user_id
      WHERE a.album_id = $1
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT $2
    `,
    [albumId, limit]
  );

  return result.rows;
}

async function getAlbumById(albumId) {
  const result = await query(
    `
      SELECT
        ${mapAlbumSelect('a')}
      FROM media_albums a
      JOIN committees c ON c.id = a.committee_id
      JOIN users creator ON creator.id = a.created_by_user_id
      LEFT JOIN users updater ON updater.id = a.updated_by_user_id
      WHERE a.id = $1
      LIMIT 1
    `,
    [albumId]
  );
  const album = result.rows[0];
  if (!album) return null;

  const assets = await listAlbumAssets(albumId);
  album.assets = assets;
  album.assets_count = assets.length;
  return album;
}

async function createAlbum({
  committeeId,
  title,
  description = null,
  coverImageUrl = null,
  status = 'draft',
  createdByUserId,
  actorUserId,
  actorUserRefId,
  assets = [],
  initialAssets = [],
}) {
  const albumId = randomUUID();
  const creatorId = createdByUserId || actorUserId || actorUserRefId;
  const pool = getPool();
  const client = await pool.connect();
  const targetAssets = Array.isArray(assets) && assets.length > 0 ? assets : (Array.isArray(initialAssets) ? initialAssets : []);

  try {
    await client.query('BEGIN');

    await client.query(
      `
        INSERT INTO media_albums (
          id,
          committee_id,
          title,
          description,
          cover_image_url,
          status,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      `,
      [
        albumId,
        committeeId,
        title.trim(),
        description ? description.trim() : null,
        coverImageUrl || null,
        status,
        creatorId,
      ]
    );

    if (targetAssets.length > 0) {
      for (const asset of targetAssets) {
        await client.query(
          `
            INSERT INTO media_album_assets (
              id,
              album_id,
              asset_url,
              asset_type,
              caption,
              created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            randomUUID(),
            albumId,
            asset.assetUrl || asset.asset_url || asset.url,
            asset.assetType || asset.asset_type || 'image',
            asset.caption || null,
            creatorId,
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAlbumById(albumId);
}

async function addAlbumAsset({
  albumId,
  assetUrl,
  assetType = 'image',
  caption = null,
  createdByUserId,
  actorUserId,
  actorUserRefId,
}) {
  const assetId = randomUUID();
  const creatorId = createdByUserId || actorUserId || actorUserRefId || null;

  const result = await query(
    `
      INSERT INTO media_album_assets (
        id,
        album_id,
        asset_url,
        asset_type,
        caption,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, album_id, asset_url, asset_type, caption, created_by_user_id, created_at
    `,
    [assetId, albumId, assetUrl, assetType, caption, creatorId]
  );

  return result.rows[0];
}

async function publishAlbum({ albumId, actorUserId, actorUserRefId }) {
  const updaterId = actorUserId || actorUserRefId || null;
  const result = await query(
    `
      UPDATE media_albums
      SET
        status = 'published',
        published_at = NOW(),
        updated_by_user_id = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [albumId, updaterId]
  );

  if (!result.rows[0]) return null;
  return getAlbumById(albumId);
}

async function listAlbums({
  committeeId = null,
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`a.committee_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    where.push(`a.status = $${values.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapAlbumSelect('a')},
        COALESCE(asset_counts.count, 0)::int AS assets_count
      FROM media_albums a
      JOIN committees c ON c.id = a.committee_id
      JOIN users creator ON creator.id = a.created_by_user_id
      LEFT JOIN users updater ON updater.id = a.updated_by_user_id
      LEFT JOIN (
        SELECT album_id, COUNT(*)::int AS count
        FROM media_album_assets
        GROUP BY album_id
      ) asset_counts ON asset_counts.album_id = a.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    values
  );

  const albums = result.rows;
  for (const album of albums) {
    album.assets = await listAlbumAssets(album.id);
    if (!album.cover_image_url && album.assets.length > 0) {
      album.cover_image_url = album.assets[0].asset_url;
    }
  }

  return albums;
}

module.exports = {
  addAlbumAsset,
  countAlbumAssets,
  createAlbum,
  getAlbumById,
  listAlbumAssets,
  listAlbums,
  publishAlbum,
};
