const crypto = require('crypto');
const { getPool } = require('../db/pool');
const { hashPassword } = require('../utils/passwordUtils');

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildScopeLabel(role, scopeType, committeeName) {
  if (scopeType === 'committee') {
    return `${capitalize(role)} - ${committeeName || 'Committee'}`;
  }
  return `${capitalize(role)} (${capitalize(scopeType)})`;
}

async function findByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const normalizedEmail = email.trim().toLowerCase();

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const userRes = await pool.query(
    `SELECT id, email, password_hash, name, avatar_url, default_role, default_scope_type, default_scope_id 
     FROM auth_users 
     WHERE email = $1 AND is_active = TRUE 
     LIMIT 1`,
    [normalizedEmail]
  );
  const user = userRes.rows[0];
  if (!user) return null;

  const rolesRes = await pool.query(
    `SELECT aur.id, aur.role, aur.scope_type, aur.scope_id, aur.committee_id, c.name AS committee_name
     FROM auth_user_roles aur
     LEFT JOIN committees c ON c.id = aur.committee_id
     WHERE aur.user_id = $1 AND aur.is_active = TRUE`,
    [user.id]
  );

  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    name: user.name,
    avatarUrl: user.avatar_url,
    defaultRole: user.default_role,
    defaultScopeType: user.default_scope_type,
    defaultScopeId: user.default_scope_id,
    availableScopes: rolesRes.rows.map((r) => ({
      id: r.id,
      role: r.role,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
      committeeId: r.committee_id,
      committeeName: r.committee_name || null,
      label: buildScopeLabel(r.role, r.scope_type, r.committee_name),
    })),
  };
}

async function findById(id) {
  if (!id) return null;

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const userRes = await pool.query(
    `SELECT id, email, password_hash, name, avatar_url, default_role, default_scope_type, default_scope_id 
     FROM auth_users 
     WHERE id = $1 AND is_active = TRUE 
     LIMIT 1`,
    [id]
  );
  const user = userRes.rows[0];
  if (!user) return null;

  const rolesRes = await pool.query(
    `SELECT aur.id, aur.role, aur.scope_type, aur.scope_id, aur.committee_id, c.name AS committee_name
     FROM auth_user_roles aur
     LEFT JOIN committees c ON c.id = aur.committee_id
     WHERE aur.user_id = $1 AND aur.is_active = TRUE`,
    [user.id]
  );

  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    name: user.name,
    avatarUrl: user.avatar_url,
    defaultRole: user.default_role,
    defaultScopeType: user.default_scope_type,
    defaultScopeId: user.default_scope_id,
    availableScopes: rolesRes.rows.map((r) => ({
      id: r.id,
      role: r.role,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
      committeeId: r.committee_id,
      committeeName: r.committee_name || null,
      label: buildScopeLabel(r.role, r.scope_type, r.committee_name),
    })),
  };
}

async function validateScope(userId, role, scopeType, scopeId) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const res = await pool.query(
    `SELECT 1 FROM auth_user_roles 
     WHERE user_id = $1 AND role = $2 AND scope_type = $3 AND scope_id = $4 AND is_active = TRUE 
     LIMIT 1`,
    [userId, role, scopeType, scopeId]
  );
  return (res.rowCount || 0) > 0;
}

async function create({ email, password, name, role = 'member', scopeType = 'global', scopeId = 'global', committeeId = null }) {
  const normalizedEmail = email.trim().toLowerCase();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const roleId = crypto.randomUUID();

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO auth_users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, normalizedEmail, passwordHash, name, role, scopeType, scopeId]
    );

    await client.query(
      `INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roleId, userId, role, scopeType, scopeId, committeeId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      const conflictErr = new Error('User with this email already exists');
      conflictErr.status = 409;
      throw conflictErr;
    }
    throw err;
  } finally {
    client.release();
  }

  return findById(userId);
}

async function assignRole({ userId, role, scopeType = 'global', scopeId = 'global', committeeId = null }) {
  const roleId = crypto.randomUUID();
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  await pool.query(
    `INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET is_active = TRUE`,
    [roleId, userId, role, scopeType, scopeId, committeeId]
  );
  return true;
}

module.exports = {
  assignRole,
  create,
  findByEmail,
  findById,
  validateScope,
};
