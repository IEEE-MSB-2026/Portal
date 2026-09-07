const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findById(id) {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id)) return null;
  const result = await query(
    'SELECT id, email, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id, created_at FROM users WHERE id = $1',
    [id]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.id,
    externalUserId: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    defaultRole: row.default_role,
    defaultScopeType: row.default_scope_type,
    defaultScopeId: row.default_scope_id,
    createdAt: row.created_at || null,
  };
}

async function findByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const result = await query(
    'SELECT id, email, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id, created_at FROM users WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.id,
    externalUserId: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    defaultRole: row.default_role,
    defaultScopeType: row.default_scope_type,
    defaultScopeId: row.default_scope_id,
    createdAt: row.created_at || null,
  };
}

async function findByExternalUserId(externalUserId) {
  if (!externalUserId) return null;
  if (typeof externalUserId === 'string') {
    if (UUID_REGEX.test(externalUserId)) {
      return findById(externalUserId);
    }
    if (externalUserId.includes('@')) {
      return findByEmail(externalUserId);
    }
    // Handle persona handles like 'member-ai-1' -> 'member.ai@ieee.local' or 'admin-1' -> 'admin@ieee.local'
    const cleanHandle = externalUserId.replace(/-\d+$/, '').replace(/-/g, '.');
    const candidateEmail = `${cleanHandle}@ieee.local`;
    const byCandidate = await findByEmail(candidateEmail);
    if (byCandidate) return byCandidate;
  }
  return null;
}

async function ensureUserRef({ externalUserId, email, name }) {
  let user = null;
  if (externalUserId) {
    user = await findByExternalUserId(externalUserId);
  }
  if (!user && email) {
    user = await findByEmail(email);
  }
  if (user) return user;

  const newId = (externalUserId && UUID_REGEX.test(externalUserId)) ? externalUserId : randomUUID();
  const userName = name || (email ? email.split('@')[0] : 'User');
  const dummyHash = '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683';
  const normEmail = email ? email.trim().toLowerCase() : `${newId}@ieee.local`;

  const insertRes = await query(
    `INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id)
     VALUES ($1, $2, $3, $4, 'member', 'global', 'global')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id`,
    [newId, normEmail, dummyHash, userName]
  );
  const row = insertRes.rows[0];
  return {
    id: row.id,
    userId: row.id,
    externalUserId: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    defaultRole: row.default_role,
    defaultScopeType: row.default_scope_type,
    defaultScopeId: row.default_scope_id,
  };
}

async function updateUserAvatar(userId, avatarData) {
  let url = avatarData;
  let publicId = null;
  let assetId = null;

  if (avatarData && typeof avatarData === 'object') {
    url = avatarData.avatarUrl || avatarData.url;
    publicId = avatarData.cloudinaryPublicId || avatarData.cloudinary_public_id || null;
    assetId = avatarData.cloudinaryAssetId || avatarData.cloudinary_asset_id || null;
  }

  const result = await query(
    `
      UPDATE users
      SET avatar_url = $2,
          cloudinary_public_id = COALESCE($3, cloudinary_public_id),
          cloudinary_asset_id = COALESCE($4, cloudinary_asset_id),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, name, avatar_url, membership_id, cloudinary_public_id, cloudinary_asset_id
    `,
    [userId, url, publicId, assetId]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.id,
    externalUserId: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    cloudinaryPublicId: row.cloudinary_public_id || null,
    cloudinaryAssetId: row.cloudinary_asset_id || null,
  };
}

async function updateUserProfile(userId, { membershipId, name }) {
  const cleanMemId = typeof membershipId === 'string' && membershipId.trim() ? membershipId.trim() : null;

  try {
    const result = await query(
      `
        UPDATE users
        SET membership_id = COALESCE($2, membership_id),
            name = COALESCE($3, name),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, name, avatar_url, membership_id
      `,
      [userId, cleanMemId, name || null]
    );

    if (!result.rows[0]) return null;
    const row = result.rows[0];

    return {
      id: row.id,
      userId: row.id,
      externalUserId: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url || null,
      membershipId: row.membership_id || null,
    };
  } catch (err) {
    if (err.code === '23505') {
      const conflictErr = new Error('An account with this IEEE Membership ID already exists');
      conflictErr.status = 409;
      throw conflictErr;
    }
    throw err;
  }
}

async function searchUsers(searchTerm, limit = 20) {
  if (!searchTerm || typeof searchTerm !== 'string') return [];
  const term = `%${searchTerm.trim().toLowerCase()}%`;
  const result = await query(
    `
      SELECT id, email, name, avatar_url, membership_id, default_role, default_scope_type, default_scope_id, created_at
      FROM users
      WHERE LOWER(name) LIKE $1 OR LOWER(email) LIKE $1 OR id::text LIKE $1
      ORDER BY name ASC
      LIMIT $2
    `,
    [term, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.id,
    externalUserId: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    defaultRole: row.default_role,
    defaultScopeType: row.default_scope_type,
    defaultScopeId: row.default_scope_id,
    createdAt: row.created_at || null,
  }));
}

module.exports = {
  ensureUserRef,
  findByEmail,
  findByExternalUserId,
  findById,
  searchUsers,
  updateUserAvatar,
  updateUserProfile,
};
