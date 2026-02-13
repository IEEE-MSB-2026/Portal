const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function ensureUserRef({ externalUserId, email }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO users_ref (id, external_user_id, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (external_user_id)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id, external_user_id, email
    `,
    [id, externalUserId, email]
  );

  return {
    id: result.rows[0].id,
    externalUserId: result.rows[0].external_user_id,
    email: result.rows[0].email,
  };
}

async function findByExternalUserId(externalUserId) {
  const result = await query(
    'SELECT id, external_user_id, email FROM users_ref WHERE external_user_id = $1',
    [externalUserId]
  );

  if (!result.rows[0]) return null;
  return {
    id: result.rows[0].id,
    externalUserId: result.rows[0].external_user_id,
    email: result.rows[0].email,
  };
}

module.exports = {
  ensureUserRef,
  findByExternalUserId,
};
