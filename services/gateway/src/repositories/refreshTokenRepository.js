const crypto = require('crypto');
const { getPool } = require('../db/pool');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function create({ userId, familyId = null, ttlDays = 7 }) {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawToken);
  const famId = familyId || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const id = crypto.randomUUID();

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query(
    `INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, tokenHash, famId, expiresAt]
  );

  return { refreshToken: rawToken, familyId: famId, expiresAt };
}

async function findByRawToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashToken(rawToken);

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const res = await pool.query(
    'SELECT id, user_id, family_id, is_revoked, expires_at, revoked_at FROM auth_refresh_tokens WHERE token_hash = $1 LIMIT 1',
    [tokenHash]
  );
  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    isRevoked: row.is_revoked,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

async function revokeById(id) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query('UPDATE auth_refresh_tokens SET is_revoked = TRUE, revoked_at = NOW() WHERE id = $1', [id]);
}

async function revokeFamily(familyId) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query('UPDATE auth_refresh_tokens SET is_revoked = TRUE WHERE family_id = $1', [familyId]);
}

async function revokeByRawToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query('UPDATE auth_refresh_tokens SET is_revoked = TRUE WHERE token_hash = $1', [tokenHash]);
}

async function revokeAllForUser(userId) {
  if (!userId) return;
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query('UPDATE auth_refresh_tokens SET is_revoked = TRUE WHERE user_id = $1', [userId]);
}

module.exports = {
  create,
  findByRawToken,
  revokeAllForUser,
  revokeById,
  revokeByRawToken,
  revokeFamily,
};
