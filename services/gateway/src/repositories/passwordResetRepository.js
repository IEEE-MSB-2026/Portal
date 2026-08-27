const crypto = require('crypto');
const { getPool } = require('../db/pool');

async function createOtp({ userId, otpHash, expiresAt }) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  // Invalidate any previously unverified/unused OTPs for this user
  await pool.query(
    `UPDATE password_reset_otps
     SET is_used = TRUE
     WHERE user_id = $1 AND is_used = FALSE`,
    [userId]
  );

  const id = crypto.randomUUID();
  const res = await pool.query(
    `INSERT INTO password_reset_otps (id, user_id, otp_hash, attempts, is_verified, is_used, expires_at)
     VALUES ($1, $2, $3, 0, FALSE, FALSE, $4)
     RETURNING id, user_id, otp_hash, attempts, is_verified, is_used, expires_at, created_at`,
    [id, userId, otpHash, expiresAt]
  );

  return res.rows[0];
}

async function findLatestActiveByUserId(userId) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  const res = await pool.query(
    `SELECT id, user_id, otp_hash, attempts, is_verified, is_used, expires_at, created_at
     FROM password_reset_otps
     WHERE user_id = $1 AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  return res.rows[0] || null;
}

async function findById(id) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  const res = await pool.query(
    `SELECT id, user_id, otp_hash, attempts, is_verified, is_used, expires_at, created_at
     FROM password_reset_otps
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return res.rows[0] || null;
}

async function incrementAttempts(id) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  const res = await pool.query(
    `UPDATE password_reset_otps
     SET attempts = attempts + 1
     WHERE id = $1
     RETURNING id, attempts`,
    [id]
  );

  return res.rows[0] ? res.rows[0].attempts : 0;
}

async function markVerified(id) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  await pool.query(
    `UPDATE password_reset_otps
     SET is_verified = TRUE
     WHERE id = $1`,
    [id]
  );
}

async function markUsed(id) {
  const pool = getPool();
  if (!pool) throw new Error('Database pool not available');

  await pool.query(
    `UPDATE password_reset_otps
     SET is_used = TRUE
     WHERE id = $1`,
    [id]
  );
}

module.exports = {
  createOtp,
  findLatestActiveByUserId,
  findById,
  incrementAttempts,
  markVerified,
  markUsed,
};
