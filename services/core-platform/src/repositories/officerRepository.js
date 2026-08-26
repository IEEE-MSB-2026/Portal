const { pool } = require('../db/index');

function validateSeasonFormat(season) {
  if (typeof season !== 'string') return false;
  const match = season.trim().match(/^(\d{4})\/(\d{4})$/);
  if (!match) return false;
  const startYear = parseInt(match[1], 10);
  const endYear = parseInt(match[2], 10);
  return endYear === startYear + 1;
}

async function listPublicOfficers({ season } = {}) {
  let query;
  let values = [];

  if (season && typeof season === 'string' && season.trim()) {
    query = `
      SELECT id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, created_at
      FROM branch_officers
      WHERE season = $1 AND is_active = TRUE
      ORDER BY display_order ASC, name ASC
    `;
    values = [season.trim()];
  } else {
    query = `
      SELECT id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, created_at
      FROM branch_officers
      WHERE (is_current_season = TRUE OR season = (SELECT season FROM branch_officers WHERE is_active = TRUE ORDER BY season DESC LIMIT 1))
        AND is_active = TRUE
      ORDER BY display_order ASC, name ASC
    `;
  }

  const { rows } = await pool.query(query, values);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    season: r.season,
    isCurrentSeason: r.is_current_season,
    avatarUrl: r.avatar_url,
    linkedinUrl: r.linkedin_url,
    email: r.email,
    bio: r.bio,
    displayOrder: r.display_order,
    createdAt: r.created_at,
  }));
}

async function listSeasons() {
  const query = `
    SELECT season, bool_or(is_current_season) as is_current, count(*)::int as member_count
    FROM branch_officers
    WHERE is_active = TRUE
    GROUP BY season
    ORDER BY season DESC
  `;
  const { rows } = await pool.query(query);
  return rows.map((r) => ({
    season: r.season,
    isCurrent: Boolean(r.is_current),
    memberCount: r.member_count,
  }));
}

async function createOfficer({ name, role, season, isCurrentSeason = false, avatarUrl, linkedinUrl, email, bio, displayOrder = 0 }) {
  if (!validateSeasonFormat(season)) {
    throw new Error('Invalid season format. Must be "YYYY/YYYY" where end year is start year + 1 (e.g. 2025/2026).');
  }

  if (isCurrentSeason) {
    // If setting this officer to current season, ensure other seasons are marked not current if desired
  }

  const query = `
    INSERT INTO branch_officers (
      name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
    RETURNING id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, created_at, updated_at
  `;

  const values = [
    name.trim(),
    role.trim(),
    season.trim(),
    Boolean(isCurrentSeason),
    avatarUrl ? avatarUrl.trim() : null,
    linkedinUrl ? linkedinUrl.trim() : null,
    email ? email.trim().toLowerCase() : null,
    bio ? bio.trim() : null,
    parseInt(displayOrder, 10) || 0,
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function updateOfficer(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name.trim());
  }
  if (data.role !== undefined) {
    fields.push(`role = $${idx++}`);
    values.push(data.role.trim());
  }
  if (data.season !== undefined) {
    if (!validateSeasonFormat(data.season)) {
      throw new Error('Invalid season format. Must be "YYYY/YYYY" (e.g. 2025/2026).');
    }
    fields.push(`season = $${idx++}`);
    values.push(data.season.trim());
  }
  if (data.isCurrentSeason !== undefined) {
    fields.push(`is_current_season = $${idx++}`);
    values.push(Boolean(data.isCurrentSeason));
  }
  if (data.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${idx++}`);
    values.push(data.avatarUrl);
  }
  if (data.linkedinUrl !== undefined) {
    fields.push(`linkedin_url = $${idx++}`);
    values.push(data.linkedinUrl);
  }
  if (data.email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(data.email ? data.email.trim().toLowerCase() : null);
  }
  if (data.bio !== undefined) {
    fields.push(`bio = $${idx++}`);
    values.push(data.bio);
  }
  if (data.displayOrder !== undefined) {
    fields.push(`display_order = $${idx++}`);
    values.push(parseInt(data.displayOrder, 10) || 0);
  }
  if (data.isActive !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(Boolean(data.isActive));
  }

  if (fields.length === 0) {
    throw new Error('No fields provided for update');
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const query = `
    UPDATE branch_officers
    SET ${fields.join(', ')}
    WHERE id = $${idx}
    RETURNING id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active, updated_at
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function deleteOfficer(id) {
  const query = `DELETE FROM branch_officers WHERE id = $1 RETURNING id`;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

module.exports = {
  validateSeasonFormat,
  listPublicOfficers,
  listSeasons,
  createOfficer,
  updateOfficer,
  deleteOfficer,
};
