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
      RETURNING id, external_user_id, email, avatar_url, membership_id
    `,
    [id, externalUserId, email]
  );

  return {
    id: result.rows[0].id,
    externalUserId: result.rows[0].external_user_id,
    email: result.rows[0].email,
    avatarUrl: result.rows[0].avatar_url || null,
    membershipId: result.rows[0].membership_id || null,
  };
}

async function findByExternalUserId(externalUserId) {
  const result = await query(
    'SELECT id, external_user_id, email, avatar_url, membership_id FROM users_ref WHERE external_user_id = $1',
    [externalUserId]
  );

  if (!result.rows[0]) return null;
  return {
    id: result.rows[0].id,
    externalUserId: result.rows[0].external_user_id,
    email: result.rows[0].email,
    avatarUrl: result.rows[0].avatar_url || null,
    membershipId: result.rows[0].membership_id || null,
  };
}

async function updateUserAvatar(userRefId, avatarData) {
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
      UPDATE users_ref
      SET avatar_url = $2,
          cloudinary_public_id = COALESCE($3, cloudinary_public_id),
          cloudinary_asset_id = COALESCE($4, cloudinary_asset_id)
      WHERE id = $1
      RETURNING id, external_user_id, email, avatar_url, membership_id, cloudinary_public_id, cloudinary_asset_id
    `,
    [userRefId, url, publicId, assetId]
  );

  if (!result.rows[0]) return null;

  const row = result.rows[0];

  // Sync to auth_users if external_user_id exists
  if (row.external_user_id) {
    try {
      await query(
        `UPDATE auth_users
         SET avatar_url = $2,
             cloudinary_public_id = COALESCE($3, cloudinary_public_id),
             cloudinary_asset_id = COALESCE($4, cloudinary_asset_id)
         WHERE id = $1`,
        [row.external_user_id, url, publicId, assetId]
      );
    } catch {
      // Ignore if auth_users is partitioned or in separate tenant
    }
  }

  return {
    id: row.id,
    externalUserId: row.external_user_id,
    email: row.email,
    avatarUrl: row.avatar_url || null,
    membershipId: row.membership_id || null,
    cloudinaryPublicId: row.cloudinary_public_id || null,
    cloudinaryAssetId: row.cloudinary_asset_id || null,
  };
}

async function updateUserProfile(userRefId, { membershipId, name }) {
  const cleanMemId = typeof membershipId === 'string' && membershipId.trim() ? membershipId.trim() : null;

  try {
    const result = await query(
      `
        UPDATE users_ref
        SET membership_id = $2
        WHERE id = $1
        RETURNING id, external_user_id, email, avatar_url, membership_id
      `,
      [userRefId, cleanMemId]
    );

    if (!result.rows[0]) return null;
    const row = result.rows[0];

    // Sync to auth_users if external_user_id exists
    if (row.external_user_id) {
      try {
        await query(
          `UPDATE auth_users
           SET membership_id = $2,
               name = COALESCE($3, name)
           WHERE id = $1`,
          [row.external_user_id, cleanMemId, name || null]
        );
      } catch (err) {
        if (err.code === '23505') {
          const conflictErr = new Error('An account with this IEEE Membership ID already exists');
          conflictErr.status = 409;
          throw conflictErr;
        }
      }
    }

    return {
      id: row.id,
      externalUserId: row.external_user_id,
      email: row.email,
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

module.exports = {
  ensureUserRef,
  findByExternalUserId,
  updateUserAvatar,
  updateUserProfile,
};

