const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createResource({ committeeId, title, url, description, createdByUserId, createdByUserRefId }) {
  const id = randomUUID();
  const targetCreatorId = createdByUserId || createdByUserRefId || null;
  const result = await query(
    `
      INSERT INTO committee_resources (id, committee_id, title, url, description, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, committee_id, title, url, description, created_at
    `,
    [id, committeeId, title, url, description || null, targetCreatorId]
  );

  return result.rows[0];
}

async function listResourcesByCommittee(committeeId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT id, committee_id, title, url, description, created_at
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
    description: row.description,
    createdAt: row.created_at,
  }));
}

module.exports = {
  createResource,
  listResourcesByCommittee,
};
