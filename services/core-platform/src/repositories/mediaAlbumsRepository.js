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
    ${prefix}.event_date,
    ${prefix}.category,
    ${prefix}.tags,
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
    c.slug AS committee_slug,
    creator.id AS created_by_external_user_id,
    creator.name AS created_by_name,
    updater.id AS updated_by_external_user_id,
    updater.name AS updated_by_name
  `;
}

async function countAlbumAssets(albumId) {
  const result = await query(
    'SELECT COUNT(*)::int AS count FROM media_album_assets WHERE album_id = $1',
    [albumId]
  );
  return result.rows[0]?.count || 0;
}

async function listAlbumAssets(albumId, { limit = 300 } = {}) {
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
        creator.name AS created_by_name,
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
      LEFT JOIN committees c ON c.id = a.committee_id
      LEFT JOIN users creator ON creator.id = a.created_by_user_id
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
  if (!album.cover_image_url && assets.length > 0) {
    album.cover_image_url = assets[0].asset_url;
  }
  return album;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function createAlbum({
  committeeId,
  title,
  description = null,
  coverImageUrl = null,
  eventDate = null,
  category = 'General',
  tags = [],
  status = 'draft',
  createdByUserId,
  actorUserId,
  actorUserRefId,
  assets = [],
  initialAssets = [],
}) {
  const albumId = randomUUID();
  const rawCreator = createdByUserId || actorUserId || actorUserRefId;
  const creatorId = rawCreator && UUID_REGEX.test(rawCreator) ? rawCreator : '11111111-0000-4000-8000-000000000001';
  const pool = getPool();
  const client = await pool.connect();
  const targetAssets = Array.isArray(assets) && assets.length > 0 ? assets : (Array.isArray(initialAssets) ? initialAssets : []);
  const targetTags = Array.isArray(tags) ? tags : [];

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
          event_date,
          category,
          tags,
          status,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      `,
      [
        albumId,
        committeeId || null,
        title.trim(),
        description ? description.trim() : null,
        coverImageUrl || null,
        eventDate ? new Date(eventDate) : null,
        category ? category.trim() : 'General',
        targetTags,
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

async function updateAlbum({
  albumId,
  title,
  description,
  coverImageUrl,
  eventDate,
  category,
  tags,
  status,
  committeeId,
  updatedByUserId,
  actorUserId,
  actorUserRefId,
}) {
  const rawUpdater = updatedByUserId || actorUserId || actorUserRefId;
  const updaterId = rawUpdater && UUID_REGEX.test(rawUpdater) ? rawUpdater : null;
  const updates = [];
  const values = [albumId];

  if (committeeId !== undefined) {
    values.push(committeeId ? committeeId : null);
    updates.push(`committee_id = $${values.length}`);
  }
  if (title !== undefined) {
    values.push(title.trim());
    updates.push(`title = $${values.length}`);
  }
  if (description !== undefined) {
    values.push(description ? description.trim() : null);
    updates.push(`description = $${values.length}`);
  }
  if (coverImageUrl !== undefined) {
    try {
      const existing = await query('SELECT cover_image_url FROM media_albums WHERE id = $1', [albumId]);
      const oldUrl = existing.rows[0]?.cover_image_url;
      if (oldUrl && oldUrl !== coverImageUrl) {
        const fileOutboxRepository = require('./fileOutboxRepository');
        await fileOutboxRepository.queueFileDeletion({
          secureUrl: oldUrl,
          resourceType: 'image',
        });
      }
    } catch {
      // Non-blocking outbox error
    }
    values.push(coverImageUrl ? coverImageUrl.trim() : null);
    updates.push(`cover_image_url = $${values.length}`);
  }
  if (eventDate !== undefined) {
    values.push(eventDate ? new Date(eventDate) : null);
    updates.push(`event_date = $${values.length}`);
  }
  if (category !== undefined) {
    values.push(category ? category.trim() : 'General');
    updates.push(`category = $${values.length}`);
  }
  if (tags !== undefined) {
    values.push(Array.isArray(tags) ? tags : []);
    updates.push(`tags = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    updates.push(`status = $${values.length}`);
    if (status === 'published') {
      updates.push('published_at = COALESCE(published_at, NOW())');
    }
  }

  if (updates.length === 0) {
    return getAlbumById(albumId);
  }

  if (updaterId) {
    values.push(updaterId);
    updates.push(`updated_by_user_id = $${values.length}`);
  }
  updates.push('updated_at = NOW()');

  const result = await query(
    `
      UPDATE media_albums
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING id
    `,
    values
  );

  if (!result.rows[0]) return null;
  return getAlbumById(albumId);
}

async function deleteAlbum(albumId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Retrieve album cover and all album assets before deleting
    const albumRes = await client.query('SELECT cover_image_url FROM media_albums WHERE id = $1', [albumId]);
    const assetsRes = await client.query('SELECT asset_url, asset_type FROM media_album_assets WHERE album_id = $1', [albumId]);

    await client.query('DELETE FROM media_album_assets WHERE album_id = $1', [albumId]);
    const res = await client.query('DELETE FROM media_albums WHERE id = $1 RETURNING id', [albumId]);

    // Queue for Cloudinary deletion
    const fileOutboxRepository = require('./fileOutboxRepository');
    if (albumRes.rows[0]?.cover_image_url) {
      await fileOutboxRepository.queueFileDeletion({
        secureUrl: albumRes.rows[0].cover_image_url,
        resourceType: 'image',
        client,
      });
    }

    for (const row of assetsRes.rows) {
      if (row.asset_url) {
        await fileOutboxRepository.queueFileDeletion({
          secureUrl: row.asset_url,
          resourceType: row.asset_type || 'image',
          client,
        });
      }
    }

    await client.query('COMMIT');
    return res.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  const rawCreator = createdByUserId || actorUserId || actorUserRefId;
  const creatorId = rawCreator && UUID_REGEX.test(rawCreator) ? rawCreator : null;

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

async function deleteAlbumAsset({ albumId, assetId }) {
  const assetRes = await query(
    'SELECT asset_url, asset_type FROM media_album_assets WHERE id = $1 AND album_id = $2',
    [assetId, albumId]
  );
  const asset = assetRes.rows[0];

  const result = await query(
    'DELETE FROM media_album_assets WHERE id = $1 AND album_id = $2 RETURNING id',
    [assetId, albumId]
  );

  if (result.rowCount > 0 && asset?.asset_url) {
    try {
      const fileOutboxRepository = require('./fileOutboxRepository');
      await fileOutboxRepository.queueFileDeletion({
        secureUrl: asset.asset_url,
        resourceType: asset.asset_type || 'image',
      });
    } catch {
      // Non-blocking outbox error
    }
  }

  return result.rowCount > 0;
}

async function publishAlbum({ albumId, actorUserId, actorUserRefId }) {
  const rawUpdater = actorUserId || actorUserRefId;
  const updaterId = rawUpdater && UUID_REGEX.test(rawUpdater) ? rawUpdater : null;
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

async function unpublishAlbum({ albumId, actorUserId, actorUserRefId }) {
  const rawUpdater = actorUserId || actorUserRefId;
  const updaterId = rawUpdater && UUID_REGEX.test(rawUpdater) ? rawUpdater : null;
  const result = await query(
    `
      UPDATE media_albums
      SET
        status = 'draft',
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
  search = null,
  limit = 50,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`a.committee_id = $${values.length}`);
  }

  if (status && status !== 'all') {
    values.push(status);
    where.push(`a.status = $${values.length}`);
  }

  if (search && search.trim()) {
    values.push(`%${search.trim().toLowerCase()}%`);
    where.push(`(
      LOWER(a.title) LIKE $${values.length}
      OR LOWER(COALESCE(a.description, '')) LIKE $${values.length}
      OR LOWER(COALESCE(a.category, '')) LIKE $${values.length}
      OR EXISTS (
        SELECT 1 FROM unnest(a.tags) tag WHERE LOWER(tag) LIKE $${values.length}
      )
    )`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapAlbumSelect('a')},
        COALESCE(asset_counts.count, 0)::int AS assets_count
      FROM media_albums a
      LEFT JOIN committees c ON c.id = a.committee_id
      LEFT JOIN users creator ON creator.id = a.created_by_user_id
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

async function getMediaStats() {
  const [albumsRes, assetsRes, publishedRes, brandRes] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM media_albums'),
    query('SELECT COUNT(*)::int AS count FROM media_album_assets'),
    query("SELECT COUNT(*)::int AS count FROM media_albums WHERE status = 'published'"),
    query('SELECT COUNT(*)::int AS count FROM media_brand_assets'),
  ]);

  return {
    totalAlbums: albumsRes.rows[0]?.count || 0,
    totalAssets: assetsRes.rows[0]?.count || 0,
    publishedAlbums: publishedRes.rows[0]?.count || 0,
    totalBrandAssets: brandRes.rows[0]?.count || 0,
  };
}

module.exports = {
  addAlbumAsset,
  countAlbumAssets,
  createAlbum,
  deleteAlbum,
  deleteAlbumAsset,
  getAlbumById,
  getMediaStats,
  listAlbumAssets,
  listAlbums,
  publishAlbum,
  unpublishAlbum,
  updateAlbum,
};
