const { randomUUID } = require('crypto');
const { query: defaultQuery } = require('../db/pool');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractPublicIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * Enqueue a file asset for asynchronous deletion directly in the file_assets table.
 * Sets status to 'pending_deletion' on existing records or inserts untracked URLs.
 * 
 * @param {Object} options
 * @param {string} [options.fileAssetId]
 * @param {string} [options.cloudinaryPublicId]
 * @param {string} [options.secureUrl]
 * @param {string} [options.resourceType='image']
 * @param {Object} [options.client] - Optional pg client for running within an active transaction
 */
async function queueFileDeletion({
  fileAssetId = null,
  cloudinaryPublicId = null,
  secureUrl = null,
  resourceType = 'image',
  client = null,
}) {
  if (!fileAssetId && !cloudinaryPublicId && !secureUrl) {
    return null;
  }

  const runQuery = client ? client.query.bind(client) : defaultQuery;

  const resolvedAssetId = fileAssetId && UUID_REGEX.test(fileAssetId) ? fileAssetId : null;
  let resolvedPublicId = cloudinaryPublicId || (secureUrl ? extractPublicIdFromUrl(secureUrl) : null);
  const resolvedResourceType = resourceType || 'image';

  // 1. Try to update existing file_assets record to pending_deletion
  if (resolvedAssetId || resolvedPublicId || secureUrl) {
    const updateSql = `
      UPDATE file_assets
      SET status = 'pending_deletion',
          updated_at = NOW()
      WHERE (id = $1 AND $1 IS NOT NULL)
         OR (cloudinary_public_id = $2 AND $2 IS NOT NULL)
         OR (secure_url = $3 AND $3 IS NOT NULL)
      RETURNING id, cloudinary_asset_id, cloudinary_public_id, secure_url, resource_type, status, created_at
    `;

    const updateRes = await runQuery(updateSql, [
      resolvedAssetId,
      resolvedPublicId,
      secureUrl || null,
    ]);

    if (updateRes.rows.length > 0) {
      return updateRes.rows[0];
    }
  }

  // 2. If no record existed in file_assets, insert an untracked asset as pending_deletion
  if (!resolvedPublicId) {
    resolvedPublicId = `untracked_${randomUUID()}`;
  }

  const newId = resolvedAssetId || randomUUID();
  const insertSql = `
    INSERT INTO file_assets (
      id,
      cloudinary_public_id,
      secure_url,
      resource_type,
      status,
      purpose,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'pending_deletion', 'cleanup', NOW(), NOW())
    ON CONFLICT (cloudinary_public_id) DO UPDATE
      SET status = 'pending_deletion',
          updated_at = NOW()
    RETURNING id, cloudinary_asset_id, cloudinary_public_id, secure_url, resource_type, status, created_at
  `;

  const insertRes = await runQuery(insertSql, [
    newId,
    resolvedPublicId,
    secureUrl || `https://res.cloudinary.com/untracked/${resolvedPublicId}`,
    resolvedResourceType,
  ]);

  return insertRes.rows[0];
}

/**
 * Enqueue multiple files for deletion in a batch.
 */
async function queueBatchDeletions(items = [], client = null) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const queued = [];
  for (const item of items) {
    const record = await queueFileDeletion({ ...item, client });
    if (record) queued.push(record);
  }
  return queued;
}

module.exports = {
  queueFileDeletion,
  queueBatchDeletions,
};
