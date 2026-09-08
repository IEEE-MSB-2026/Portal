const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapExcomRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    position: row.position,
    customTitle: row.custom_title || null,
    season: row.season,
    isActive: Boolean(row.is_active),
    appointedByUserId: row.appointed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      avatarUrl: row.user_avatar,
      phone: row.user_phone,
      bio: row.user_bio,
      university: row.user_university,
      faculty: row.user_faculty,
      department: row.user_department,
      academicYear: row.user_academic_year,
      socialLinks: row.user_social_links || {},
    },
  };
}

async function listExcomMembers({ season } = {}) {
  const conditions = ['em.is_active = TRUE'];
  const values = [];

  if (season && typeof season === 'string' && season.trim()) {
    values.push(season.trim());
    conditions.push(`em.season = $${values.length}`);
  }

  const sql = `
    SELECT
      em.id, em.user_id, em.position, em.custom_title, em.season, em.is_active,
      em.appointed_by_user_id, em.created_at, em.updated_at,
      u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar,
      u.phone AS user_phone, u.bio AS user_bio, u.university AS user_university,
      u.faculty AS user_faculty, u.department AS user_department,
      u.academic_year AS user_academic_year, u.social_links AS user_social_links
    FROM branch_excom_members em
    JOIN users u ON u.id = em.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE LOWER(em.position)
        WHEN 'chairman' THEN 1
        WHEN 'vice_chairman' THEN 2
        WHEN 'treasurer' THEN 3
        WHEN 'secretary' THEN 4
        WHEN 'webmaster' THEN 5
        ELSE 6
      END ASC,
      em.created_at ASC
  `;

  const result = await query(sql, values);
  return result.rows.map(mapExcomRow);
}

async function getExcomMemberById(id) {
  const sql = `
    SELECT
      em.id, em.user_id, em.position, em.custom_title, em.season, em.is_active,
      em.appointed_by_user_id, em.created_at, em.updated_at,
      u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar,
      u.phone AS user_phone, u.bio AS user_bio, u.university AS user_university,
      u.faculty AS user_faculty, u.department AS user_department,
      u.academic_year AS user_academic_year, u.social_links AS user_social_links
    FROM branch_excom_members em
    JOIN users u ON u.id = em.user_id
    WHERE em.id = $1
  `;
  const result = await query(sql, [id]);
  return mapExcomRow(result.rows[0]);
}

async function assignExcomMember({
  userId,
  position,
  customTitle,
  season,
  appointedByUserId,
}) {
  const id = randomUUID();
  const normalizedPosition = position ? position.trim().toLowerCase() : 'officer';
  const targetSeason = season && season.trim() ? season.trim() : '2025/2026';

  // 1. Insert or update branch_excom_members
  const insertSql = `
    INSERT INTO branch_excom_members (
      id, user_id, position, custom_title, season, is_active, appointed_by_user_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW(), NOW())
    ON CONFLICT (user_id, season) DO UPDATE SET
      position = EXCLUDED.position,
      custom_title = EXCLUDED.custom_title,
      is_active = TRUE,
      appointed_by_user_id = EXCLUDED.appointed_by_user_id,
      updated_at = NOW()
    RETURNING id
  `;

  const res = await query(insertSql, [
    id,
    userId,
    normalizedPosition,
    customTitle ? customTitle.trim() : null,
    targetSeason,
    appointedByUserId || null,
  ]);

  const recordId = res.rows[0].id;

  // 2. Grant global officer role in auth_user_roles if user does not already have admin or officer
  const userCheck = await query('SELECT default_role FROM users WHERE id = $1', [userId]);
  const currentRole = userCheck.rows[0]?.default_role;

  if (currentRole !== 'admin') {
    await query(
      `
        INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, is_active)
        VALUES ($1, $2, 'officer', 'global', 'global', TRUE)
        ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET is_active = TRUE
      `,
      [randomUUID(), userId]
    );

    // Update default_role to officer if not admin
    await query(`UPDATE users SET default_role = 'officer', updated_at = NOW() WHERE id = $1 AND default_role != 'admin'`, [userId]);
  }

  return getExcomMemberById(recordId);
}

async function removeExcomMember(id) {
  const existing = await query('SELECT user_id, season FROM branch_excom_members WHERE id = $1', [id]);
  if (existing.rows.length === 0) return null;

  const { user_id: userId } = existing.rows[0];

  await query('DELETE FROM branch_excom_members WHERE id = $1', [id]);

  // Check if user has other active excom memberships
  const remaining = await query('SELECT id FROM branch_excom_members WHERE user_id = $1 AND is_active = TRUE', [userId]);
  if (remaining.rows.length === 0) {
    // Check if user is an admin; if not, demote officer role
    const userRow = await query('SELECT default_role FROM users WHERE id = $1', [userId]);
    if (userRow.rows[0]?.default_role !== 'admin') {
      await query(
        `DELETE FROM auth_user_roles WHERE user_id = $1 AND role = 'officer' AND scope_type = 'global' AND scope_id = 'global'`,
        [userId]
      );
      await query(`UPDATE users SET default_role = 'member', updated_at = NOW() WHERE id = $1 AND default_role = 'officer'`, [userId]);
    }
  }

  return { id, userId };
}

async function searchCandidateUsers(searchQuery) {
  if (!searchQuery || !searchQuery.trim()) {
    return [];
  }

  const term = `%${searchQuery.trim().toLowerCase()}%`;
  const sql = `
    SELECT id, name, email, avatar_url, default_role, department, university
    FROM users
    WHERE is_active = TRUE AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)
    ORDER BY name ASC
    LIMIT 20
  `;

  const result = await query(sql, [term]);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    avatarUrl: r.avatar_url,
    defaultRole: r.default_role,
    department: r.department,
    university: r.university,
  }));
}

module.exports = {
  listExcomMembers,
  getExcomMemberById,
  assignExcomMember,
  removeExcomMember,
  searchCandidateUsers,
};
