const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapBrandAssetColumns(prefix = 'b') {
  return `
    ${prefix}.id,
    ${prefix}.title,
    ${prefix}.description,
    ${prefix}.category,
    ${prefix}.file_url,
    ${prefix}.thumbnail_url,
    ${prefix}.file_format,
    ${prefix}.file_size_bytes,
    ${prefix}.tags,
    ${prefix}.created_by_user_id,
    ${prefix}.created_by_user_id AS created_by_user_ref_id,
    ${prefix}.updated_by_user_id,
    ${prefix}.updated_by_user_id AS updated_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at
  `;
}

function mapBrandAssetSelect(prefix = 'b') {
  return `
    ${mapBrandAssetColumns(prefix)},
    creator.id AS created_by_external_user_id,
    creator.name AS created_by_name,
    updater.id AS updated_by_external_user_id,
    updater.name AS updated_by_name
  `;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getBrandAssetById(assetId) {
  const result = await query(
    `
      SELECT
        ${mapBrandAssetSelect('b')}
      FROM media_brand_assets b
      LEFT JOIN users creator ON creator.id = b.created_by_user_id
      LEFT JOIN users updater ON updater.id = b.updated_by_user_id
      WHERE b.id = $1
      LIMIT 1
    `,
    [assetId]
  );

  return result.rows[0] || null;
}

async function createBrandAsset({
  title,
  description = null,
  category = 'logos',
  fileUrl,
  thumbnailUrl = null,
  fileFormat = null,
  fileSizeBytes = 0,
  tags = [],
  createdByUserId,
  actorUserId,
  actorUserRefId,
}) {
  const assetId = randomUUID();
  const rawCreator = createdByUserId || actorUserId || actorUserRefId;
  const creatorId = rawCreator && UUID_REGEX.test(rawCreator) ? rawCreator : '11111111-0000-4000-8000-000000000001';
  const targetTags = Array.isArray(tags) ? tags : [];

  await query(
    `
      INSERT INTO media_brand_assets (
        id,
        title,
        description,
        category,
        file_url,
        thumbnail_url,
        file_format,
        file_size_bytes,
        tags,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    `,
    [
      assetId,
      title.trim(),
      description ? description.trim() : null,
      category.trim().toLowerCase(),
      fileUrl.trim(),
      thumbnailUrl ? thumbnailUrl.trim() : null,
      fileFormat ? fileFormat.trim().toLowerCase() : null,
      fileSizeBytes || 0,
      targetTags,
      creatorId,
    ]
  );

  return getBrandAssetById(assetId);
}

async function updateBrandAsset({
  assetId,
  title,
  description,
  category,
  fileUrl,
  thumbnailUrl,
  fileFormat,
  fileSizeBytes,
  tags,
  updatedByUserId,
  actorUserId,
  actorUserRefId,
}) {
  const rawUpdater = updatedByUserId || actorUserId || actorUserRefId;
  const updaterId = rawUpdater && UUID_REGEX.test(rawUpdater) ? rawUpdater : null;
  const updates = [];
  const values = [assetId];

  if (title !== undefined) {
    values.push(title.trim());
    updates.push(`title = $${values.length}`);
  }
  if (description !== undefined) {
    values.push(description ? description.trim() : null);
    updates.push(`description = $${values.length}`);
  }
  if (category !== undefined) {
    values.push(category.trim().toLowerCase());
    updates.push(`category = $${values.length}`);
  }
  if (fileUrl !== undefined) {
    values.push(fileUrl.trim());
    updates.push(`file_url = $${values.length}`);
  }
  if (thumbnailUrl !== undefined) {
    values.push(thumbnailUrl ? thumbnailUrl.trim() : null);
    updates.push(`thumbnail_url = $${values.length}`);
  }
  if (fileFormat !== undefined) {
    values.push(fileFormat ? fileFormat.trim().toLowerCase() : null);
    updates.push(`file_format = $${values.length}`);
  }
  if (fileSizeBytes !== undefined) {
    values.push(fileSizeBytes || 0);
    updates.push(`file_size_bytes = $${values.length}`);
  }
  if (tags !== undefined) {
    values.push(Array.isArray(tags) ? tags : []);
    updates.push(`tags = $${values.length}`);
  }

  if (updates.length === 0) {
    return getBrandAssetById(assetId);
  }

  if (updaterId) {
    values.push(updaterId);
    updates.push(`updated_by_user_id = $${values.length}`);
  }
  updates.push('updated_at = NOW()');

  const result = await query(
    `
      UPDATE media_brand_assets
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING id
    `,
    values
  );

  if (!result.rows[0]) return null;
  return getBrandAssetById(assetId);
}

async function deleteBrandAsset(assetId) {
  const result = await query(
    'DELETE FROM media_brand_assets WHERE id = $1 RETURNING id',
    [assetId]
  );
  return result.rowCount > 0;
}

async function listBrandAssets({
  category = null,
  search = null,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (category && category !== 'all') {
    values.push(category.toLowerCase());
    where.push(`b.category = $${values.length}`);
  }

  if (search && search.trim()) {
    values.push(`%${search.trim().toLowerCase()}%`);
    where.push(`(
      LOWER(b.title) LIKE $${values.length}
      OR LOWER(COALESCE(b.description, '')) LIKE $${values.length}
      OR EXISTS (
        SELECT 1 FROM unnest(b.tags) tag WHERE LOWER(tag) LIKE $${values.length}
      )
    )`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapBrandAssetSelect('b')}
      FROM media_brand_assets b
      LEFT JOIN users creator ON creator.id = b.created_by_user_id
      LEFT JOIN users updater ON updater.id = b.updated_by_user_id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    values
  );

  return result.rows;
}

async function countBrandAssets() {
  const result = await query('SELECT COUNT(*)::int AS count FROM media_brand_assets');
  return result.rows[0]?.count || 0;
}

module.exports = {
  countBrandAssets,
  createBrandAsset,
  deleteBrandAsset,
  getBrandAssetById,
  listBrandAssets,
  updateBrandAsset,
};
