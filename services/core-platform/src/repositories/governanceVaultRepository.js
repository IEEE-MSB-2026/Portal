const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const fileOutboxRepository = require('./fileOutboxRepository');

function mapDocRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    fileUrl: row.file_url,
    fileSizeBytes: row.file_size_bytes ? parseInt(row.file_size_bytes, 10) : null,
    tag: row.tag || null,
    description: row.description || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedByUserId: row.uploaded_by_user_id,
    uploaderName: row.uploader_name || null,
    uploaderAvatar: row.uploader_avatar || null,
    uploaderEmail: row.uploader_email || null,
  };
}

async function listDocuments({ tag, search } = {}) {
  const conditions = [];
  const values = [];

  if (tag && typeof tag === 'string' && tag.trim() && tag.trim().toLowerCase() !== 'all') {
    values.push(tag.trim());
    conditions.push(`LOWER(d.tag) = LOWER($${values.length})`);
  }

  if (search && typeof search === 'string' && search.trim()) {
    values.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(LOWER(d.title) LIKE $${values.length} OR LOWER(COALESCE(d.description, '')) LIKE $${values.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      d.id, d.title, d.file_url, d.file_size_bytes, d.tag, d.description,
      d.created_at, d.updated_at, d.uploaded_by_user_id,
      u.name AS uploader_name, u.avatar_url AS uploader_avatar, u.email AS uploader_email
    FROM branch_governance_documents d
    LEFT JOIN users u ON u.id = d.uploaded_by_user_id
    ${whereClause}
    ORDER BY d.created_at DESC
  `;

  const result = await query(sql, values);
  return result.rows.map(mapDocRow);
}

async function getDocumentById(id) {
  const sql = `
    SELECT
      d.id, d.title, d.file_url, d.file_size_bytes, d.tag, d.description,
      d.created_at, d.updated_at, d.uploaded_by_user_id,
      u.name AS uploader_name, u.avatar_url AS uploader_avatar, u.email AS uploader_email
    FROM branch_governance_documents d
    LEFT JOIN users u ON u.id = d.uploaded_by_user_id
    WHERE d.id = $1
  `;
  const result = await query(sql, [id]);
  return mapDocRow(result.rows[0]);
}

async function createDocument({
  title,
  fileUrl,
  fileSizeBytes,
  tag,
  description,
  uploadedByUserId,
}) {
  const id = randomUUID();

  const sql = `
    INSERT INTO branch_governance_documents (
      id, title, file_url, file_size_bytes, tag, description, uploaded_by_user_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING id
  `;

  await query(sql, [
    id,
    title.trim(),
    fileUrl.trim(),
    fileSizeBytes || null,
    tag ? tag.trim() : null,
    description ? description.trim() : null,
    uploadedByUserId || null,
  ]);

  return getDocumentById(id);
}

async function updateDocument(id, data) {
  const existing = await query('SELECT file_url FROM branch_governance_documents WHERE id = $1', [id]);
  if (existing.rows.length === 0) return null;

  const oldFileUrl = existing.rows[0].file_url;
  const updates = [];
  const values = [];

  if (data.title !== undefined) {
    values.push(data.title.trim());
    updates.push(`title = $${values.length}`);
  }

  if (data.fileUrl !== undefined) {
    const newUrl = data.fileUrl.trim();
    values.push(newUrl);
    updates.push(`file_url = $${values.length}`);

    if (oldFileUrl && oldFileUrl !== newUrl) {
      await fileOutboxRepository.queueFileDeletion({
        secureUrl: oldFileUrl,
        resourceType: 'raw',
      });
    }
  }

  if (data.fileSizeBytes !== undefined) {
    values.push(data.fileSizeBytes || null);
    updates.push(`file_size_bytes = $${values.length}`);
  }

  if (data.tag !== undefined) {
    values.push(data.tag ? data.tag.trim() : null);
    updates.push(`tag = $${values.length}`);
  }

  if (data.description !== undefined) {
    values.push(data.description ? data.description.trim() : null);
    updates.push(`description = $${values.length}`);
  }

  if (updates.length === 0) {
    return getDocumentById(id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE branch_governance_documents
    SET ${updates.join(', ')}
    WHERE id = $${values.length}
    RETURNING id
  `;

  await query(sql, values);
  return getDocumentById(id);
}

async function deleteDocument(id) {
  const existing = await query('SELECT file_url FROM branch_governance_documents WHERE id = $1', [id]);
  if (existing.rows.length === 0) return null;

  const fileUrl = existing.rows[0].file_url;
  if (fileUrl) {
    await fileOutboxRepository.queueFileDeletion({
      secureUrl: fileUrl,
      resourceType: 'raw',
    });
  }

  const result = await query('DELETE FROM branch_governance_documents WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

module.exports = {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
};
