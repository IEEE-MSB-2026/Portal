const crypto = require('crypto');
const { getPool } = require('../db/pool');
const { hashPassword } = require('../utils/passwordUtils');

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildScopeLabel(role, scopeType, committeeSlug) {
  if (scopeType === 'committee') {
    const roleLabel = role === 'hr' ? 'HR' : capitalize(role);
    return `${roleLabel} - ${committeeSlug ? committeeSlug.toUpperCase() : 'Committee'}`;
  }
  const roleLabel = role === 'hr' ? 'HR' : capitalize(role);
  return `${roleLabel} (${capitalize(scopeType)})`;
}

function formatAvailableScopes(rows) {
  // Sort rows so that 'lead' comes before 'member' and 'member' before 'hr' if both exist
  const roleRank = { lead: 1, member: 2, hr: 3 };
  const sorted = [...rows].sort((a, b) => {
    const rankA = roleRank[a.role] || 99;
    const rankB = roleRank[b.role] || 99;
    return rankA - rankB;
  });

  const scopeMap = new Map();
  for (const r of sorted) {
    const committeeId = r.committee_id || (r.scope_type === 'committee' ? r.scope_id : null);
    const scopeKey = r.scope_type === 'committee'
      ? `committee:${committeeId || r.scope_id}`
      : `${r.scope_type}:${r.scope_id}:${r.role}`;

    if (!scopeMap.has(scopeKey)) {
      scopeMap.set(scopeKey, {
        id: r.id,
        role: r.role,
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        committeeId,
        committeeSlug: r.committee_slug || null,
        committeeName: r.committee_name || null,
        label: buildScopeLabel(r.role, r.scope_type, r.committee_slug || r.committee_name),
      });
    }
  }

  return Array.from(scopeMap.values());
}

async function findByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const normalizedEmail = email.trim().toLowerCase();

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const userRes = await pool.query(
    `SELECT id, email, password_hash, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id 
     FROM users 
     WHERE email = $1 AND is_active = TRUE 
     LIMIT 1`,
    [normalizedEmail]
  );
  const user = userRes.rows[0];
  if (!user) return null;

  const rolesRes = await pool.query(
    `SELECT aur.id, aur.role, aur.scope_type, aur.scope_id, aur.committee_id, c.slug AS committee_slug, c.name AS committee_name
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
    membershipId: user.membership_id || null,
    defaultRole: user.default_role,
    defaultScopeType: user.default_scope_type,
    defaultScopeId: user.default_scope_id,
    availableScopes: formatAvailableScopes(rolesRes.rows),
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findById(id) {
  if (!id) return null;

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  let user = null;
  if (UUID_REGEX.test(id)) {
    const userRes = await pool.query(
      `SELECT id, email, password_hash, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id 
       FROM users 
       WHERE id = $1 AND is_active = TRUE 
       LIMIT 1`,
      [id]
    );
    user = userRes.rows[0];
  } else {
    const cleanHandle = String(id).replace(/-[0-9]+$/, '').replace(/-/g, '.');
    const candidateEmail = `${cleanHandle}@ieee.local`;
    const userRes = await pool.query(
      `SELECT id, email, password_hash, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id 
       FROM users 
       WHERE (email = $1 OR email = $2) AND is_active = TRUE 
       LIMIT 1`,
      [id, candidateEmail]
    );
    user = userRes.rows[0];
  }

  if (!user) return null;

  const rolesRes = await pool.query(
    `SELECT aur.id, aur.role, aur.scope_type, aur.scope_id, aur.committee_id, c.slug AS committee_slug, c.name AS committee_name
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
    membershipId: user.membership_id || null,
    defaultRole: user.default_role,
    defaultScopeType: user.default_scope_type,
    defaultScopeId: user.default_scope_id,
    availableScopes: formatAvailableScopes(rolesRes.rows),
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

async function create({ email, password, name, membershipId = null, role = 'member', scopeType = 'global', scopeId = 'global', committeeId = null }) {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanMemId = typeof membershipId === 'string' && membershipId.trim() ? membershipId.trim() : null;
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const roleId = crypto.randomUUID();

  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const client = await pool.connect();
  try {
    if (cleanMemId) {
      const existingMem = await client.query(
        'SELECT 1 FROM users WHERE membership_id = $1 AND is_active = TRUE LIMIT 1',
        [cleanMemId]
      );
      if (existingMem.rows.length > 0) {
        const conflictErr = new Error('An account with this IEEE Membership ID already exists');
        conflictErr.status = 409;
        throw conflictErr;
      }
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (id, email, password_hash, name, membership_id, default_role, default_scope_type, default_scope_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, normalizedEmail, passwordHash, name, cleanMemId, role, scopeType, scopeId]
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
      const detail = String(err.detail || err.message || '');
      if (detail.includes('membership_id') || err.constraint === 'idx_users_membership_id') {
        const conflictErr = new Error('An account with this IEEE Membership ID already exists');
        conflictErr.status = 409;
        throw conflictErr;
      }
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

  const user = await findById(userId);
  const targetUserId = user ? user.id : userId;
  const effectiveCommitteeId = scopeType === 'committee' ? (committeeId || scopeId) : null;

  // 1. For committee scopes, deactivate any existing role in the same committee to prevent duplicate roles
  if (scopeType === 'committee' && (scopeId || effectiveCommitteeId)) {
    const targetScopeId = scopeId ? String(scopeId) : null;
    const targetCommitteeId = effectiveCommitteeId ? String(effectiveCommitteeId) : null;
    await pool.query(
      `UPDATE auth_user_roles 
       SET is_active = FALSE 
       WHERE user_id = $1 
         AND is_active = TRUE
         AND (scope_type = 'committee' OR committee_id IS NOT NULL)
         AND (scope_id = $2 OR committee_id::text = $2 OR scope_id = $3 OR committee_id::text = $3)`,
      [targetUserId, targetScopeId, targetCommitteeId]
    );
  }

  // 2. Insert or reactivate the target role
  await pool.query(
    `INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET is_active = TRUE, committee_id = EXCLUDED.committee_id`,
    [roleId, targetUserId, role, scopeType, scopeId, effectiveCommitteeId]
  );
  return true;
}

async function revokeRole({ userId, scopeType = 'committee', scopeId = null }) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const user = await findById(userId);
  const targetUserId = user ? user.id : userId;

  if (scopeId) {
    await pool.query(
      `UPDATE auth_user_roles 
       SET is_active = FALSE 
       WHERE user_id = $1 AND ((scope_type = $2 AND scope_id = $3) OR committee_id::text = $3)`,
      [targetUserId, scopeType, String(scopeId)]
    );
  } else {
    await pool.query(
      `UPDATE auth_user_roles 
       SET is_active = FALSE 
       WHERE user_id = $1 AND scope_type = $2`,
      [targetUserId, scopeType]
    );
  }
  return true;
}

async function updatePassword(userId, newPasswordHash) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database connection pool is not available');
  }

  const result = await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND is_active = TRUE RETURNING id`,
    [newPasswordHash, userId]
  );

  if (!result.rows[0]) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  return true;
}

module.exports = {
  assignRole,
  revokeRole,
  create,
  findByEmail,
  findById,
  updatePassword,
  validateScope,
};
