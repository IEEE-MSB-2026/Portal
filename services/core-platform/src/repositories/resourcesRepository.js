const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createResource({
  committeeId,
  title,
  url,
  resourceType = 'link',
  description,
  createdByUserId,
  createdByUserRefId,
}) {
  const id = randomUUID();
  const targetCreatorId = createdByUserId || createdByUserRefId || null;
  const targetResourceType = typeof resourceType === 'string' && resourceType.trim() ? resourceType.trim().toLowerCase() : 'link';

  const result = await query(
    `
      INSERT INTO committee_resources (
        id,
        committee_id,
        title,
        url,
        resource_type,
        description,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, committee_id, title, url, resource_type, description, created_at
    `,
    [id, committeeId, title, url, targetResourceType, description || null, targetCreatorId]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    url: row.url,
    resourceType: row.resource_type || 'link',
    description: row.description,
    createdAt: row.created_at,
  };
}

async function listResourcesByCommittee(committeeId, { limit = 50 } = {}) {
  const result = await query(
    `
      SELECT id, committee_id, title, url, resource_type, description, created_at
      FROM committee_resources
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
    url: row.url,
    resourceType: row.resource_type || 'link',
    description: row.description,
    createdAt: row.created_at,
  }));
}

async function getResourceById(resourceId) {
  const result = await query(
    `
      SELECT id, committee_id, title, url, resource_type, description, created_at
      FROM committee_resources
      WHERE id = $1
      LIMIT 1
    `,
    [resourceId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    url: row.url,
    resourceType: row.resource_type || 'link',
    description: row.description,
    createdAt: row.created_at,
  };
}

async function updateResource(resourceId, committeeId, { title, description }) {
  const updates = [];
  const params = [resourceId];
  let idx = 2;

  if (title !== undefined) {
    updates.push(`title = $${idx++}`);
    params.push(title);
  }
  if (description !== undefined) {
    updates.push(`description = $${idx++}`);
    params.push(description);
  }

  if (updates.length === 0) {
    return getResourceById(resourceId);
  }

  let queryText = `UPDATE committee_resources SET ${updates.join(', ')} WHERE id = $1`;
  if (committeeId) {
    queryText += ` AND committee_id = $${idx++}`;
    params.push(committeeId);
  }
  queryText += ` RETURNING id, committee_id, title, url, resource_type, description, created_at`;

  const result = await query(queryText, params);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    committeeId: row.committee_id,
    title: row.title,
    url: row.url,
    resourceType: row.resource_type || 'link',
    description: row.description,
    createdAt: row.created_at,
  };
}

async function deleteResource(resourceId, committeeId) {
  let queryText = `DELETE FROM committee_resources WHERE id = $1`;
  const params = [resourceId];
  if (committeeId) {
    queryText += ` AND committee_id = $2`;
    params.push(committeeId);
  }
  queryText += ` RETURNING id`;
  const result = await query(queryText, params);
  return result.rowCount > 0;
}

module.exports = {
  createResource,
  listResourcesByCommittee,
  getResourceById,
  updateResource,
  deleteResource,
};
