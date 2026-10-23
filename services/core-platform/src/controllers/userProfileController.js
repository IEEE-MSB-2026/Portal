const { query } = require('../db');
const { HttpError } = require('../utils/httpErrors');
const logger = require('../utils/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /core/users/:userId/profile or GET /public/users/:userId/profile
 * Retrieves a public/tiered user profile with badges, committee roles, and stats.
 */
async function getUserProfile(req, res, next) {
  try {
    const { userId } = req.params;

    if (!userId || !UUID_REGEX.test(userId)) {
      throw new HttpError(400, 'Invalid user ID format. UUID is required.');
    }

    const callerUserId = req.headers['x-user-id'] || null;
    const callerRole = (req.headers['x-user-role'] || '').toLowerCase();
    const callerCommitteeId = req.headers['x-user-committee-id'] || null;

    // 1. Fetch user core info
    const userRes = await query(
      `
        SELECT
          id,
          name,
          email,
          phone,
          avatar_url,
          membership_id,
          bio,
          university,
          faculty,
          department,
          academic_year,
          social_links,
          default_role,
          default_scope_type,
          default_scope_id,
          created_at
        FROM users
        WHERE id = $1 AND is_active = TRUE
      `,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new HttpError(404, 'User not found or inactive');
    }

    const user = userRes.rows[0];

    // 2. Fetch committee memberships & official roles (always included in public tier)
    const membershipsRes = await query(
      `
        SELECT
          cm.id,
          cm.committee_id,
          cm.role_in_committee,
          cm.created_at AS joined_at,
          c.name AS committee_name,
          c.slug AS committee_slug
        FROM committee_memberships cm
        JOIN committees c ON cm.committee_id = c.id
        WHERE cm.user_id = $1 AND c.is_active = TRUE
        ORDER BY cm.created_at ASC
      `,
      [userId]
    );

    const memberships = membershipsRes.rows;

    // 2b. Fetch active global roles from auth_user_roles (source of truth for officer/admin grants)
    const globalRolesRes = await query(
      `
        SELECT role
        FROM auth_user_roles
        WHERE user_id = $1
          AND is_active = TRUE
          AND (scope_type = 'global' OR scope_type IS NULL)
        ORDER BY created_at ASC
      `,
      [userId]
    ).catch(() => ({ rows: [] }));

    const globalRoles = globalRolesRes.rows.map((r) => r.role.toLowerCase());

    // 3. Fetch activity stats aggregates
    const [tasksRes, assignmentsRes] = await Promise.all([
      query(
        `
          SELECT COUNT(*)::int AS count
          FROM tasks
          WHERE assignee_user_id = $1 AND status = 'done'
        `,
        [userId]
      ).catch(() => ({ rows: [{ count: 0 }] })),
      query(
        `
          SELECT COUNT(*)::int AS count
          FROM assignment_submissions
          WHERE user_id = $1
        `,
        [userId]
      ).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const tasksCompleted = tasksRes.rows[0]?.count || 0;
    const assignmentsSubmitted = assignmentsRes.rows[0]?.count || 0;

    // 4. Determine tiered authorization for private contact details
    const isSelf = Boolean(callerUserId && callerUserId === userId);
    const isGlobalAdminOrOfficer = ['admin', 'officer'].includes(callerRole);
    const isHR = callerRole === 'hr';
    const isUserCommitteeLead = Boolean(
      callerCommitteeId &&
      callerRole === 'lead' &&
      memberships.some((m) => m.committee_id === callerCommitteeId)
    );

    const canViewPrivate = isSelf || isGlobalAdminOrOfficer || isHR || isUserCommitteeLead;

    // 4.5 Fetch applications if authorized
    let applications = [];
    if (canViewPrivate) {
      const appsRes = await query(
        `
          SELECT
            a.id,
            a.campaign_id,
            COALESCE(a.committee_id, c.committee_id) AS committee_id,
            c.title AS campaign_title,
            cc.name AS committee_name,
            a.current_stage,
            a.submitted_at,
            a.created_at
          FROM hr_applications a
          JOIN hr_campaigns c ON c.id = a.campaign_id
          JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
          WHERE a.applicant_user_id = $1
          ORDER BY a.submitted_at DESC
        `,
        [userId]
      ).catch(() => ({ rows: [] }));

      applications = appsRes.rows.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        committeeId: row.committee_id,
        campaignTitle: row.campaign_title,
        committeeName: row.committee_name,
        currentStage: row.current_stage,
        submittedAt: row.submitted_at,
        createdAt: row.created_at,
      }));
    }

    // Clean social links (excluding discord)
    const rawSocials = user.social_links && typeof user.social_links === 'object' ? user.social_links : {};
    const cleanSocials = {
      github: rawSocials.github || '',
      linkedin: rawSocials.linkedin || '',
      website: rawSocials.website || '',
    };

    // Determine primary display role using priority hierarchy:
    // admin(1) > officer(2) > lead(3) > hr(4) > publisher(5) > scanner/event_scanner(6) > member(7) > applicant(8)
    const ROLE_PRIORITY = {
      admin: 1, officer: 2, lead: 3, hr: 4,
      publisher: 5, event_scanner: 6, scanner: 6, member: 7, applicant: 8,
    };

    const roleCandidates = [
      ...globalRoles,                                           // auth_user_roles (most authoritative)
      user.default_role ? user.default_role.toLowerCase() : null, // fallback: users.default_role
      ...memberships.map((m) => (m.role_in_committee || '').toLowerCase()), // committee roles
    ].filter(Boolean);

    const displayRole = roleCandidates.length > 0
      ? roleCandidates.reduce((best, r) => {
          const bP = ROLE_PRIORITY[best] ?? 99;
          const rP = ROLE_PRIORITY[r] ?? 99;
          return rP < bP ? r : best;
        })
      : 'member';

    // 5. Structure payload
    const profile = {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatar_url,
      membershipId: user.membership_id,
      role: displayRole,
      defaultRole: user.default_role || 'member',
      scopeType: user.default_scope_type || 'global',
      bio: user.bio || '',
      university: user.university || '',
      faculty: user.faculty || '',
      department: user.department || '',
      academicYear: user.academic_year || '',
      socialLinks: cleanSocials,
      createdAt: user.created_at,
      committees: memberships.map((m) => ({
        committeeId: m.committee_id,
        committeeName: m.committee_name,
        committeeSlug: m.committee_slug,
        roleInCommittee: m.role_in_committee,
        joinedAt: m.joined_at,
      })),
      applications,
      stats: {
        tasksCompleted,
        assignmentsSubmitted,
        committeesCount: memberships.length,
      },
      email: canViewPrivate ? user.email : undefined,
      phone: canViewPrivate ? (user.phone || null) : undefined,
      isSelf,
      canViewPrivate,
    };

    return res.json({ profile });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /core/me/profile
 * Allows authenticated user to update their personal and public profile details.
 */
async function updateMyPublicProfile(req, res, next) {
  try {
    const callerUserId = req.headers['x-user-id'];
    if (!callerUserId) {
      throw new HttpError(401, 'Unauthorized: Caller identity missing');
    }

    const {
      name,
      membershipId,
      bio,
      university,
      faculty,
      department,
      academicYear,
      phone,
      socialLinks,
    } = req.body;

    // Validate socialLinks if provided
    let cleanSocialLinks = null;
    if (socialLinks !== undefined) {
      if (typeof socialLinks !== 'object' || Array.isArray(socialLinks)) {
        throw new HttpError(400, 'socialLinks must be an object');
      }
      cleanSocialLinks = {
        github: typeof socialLinks.github === 'string' ? socialLinks.github.trim() : '',
        linkedin: typeof socialLinks.linkedin === 'string' ? socialLinks.linkedin.trim() : '',
        website: typeof socialLinks.website === 'string' ? socialLinks.website.trim() : '',
      };
    }

    // Build dynamic UPDATE query based on provided fields
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) {
        throw new HttpError(400, 'Full Name cannot be empty');
      }
      updates.push(`name = $${paramIdx++}`);
      values.push(cleanName);
    }

    if (membershipId !== undefined) {
      const cleanMemId = typeof membershipId === 'string' && membershipId.trim() ? membershipId.trim() : null;
      updates.push(`membership_id = $${paramIdx++}`);
      values.push(cleanMemId);
    }

    if (bio !== undefined) {
      updates.push(`bio = $${paramIdx++}`);
      values.push(typeof bio === 'string' ? bio.trim() : (bio || null));
    }

    if (university !== undefined) {
      updates.push(`university = $${paramIdx++}`);
      values.push(typeof university === 'string' ? university.trim() : (university || null));
    }

    if (faculty !== undefined) {
      updates.push(`faculty = $${paramIdx++}`);
      values.push(typeof faculty === 'string' ? faculty.trim() : (faculty || null));
    }

    if (department !== undefined) {
      updates.push(`department = $${paramIdx++}`);
      values.push(typeof department === 'string' ? department.trim() : (department || null));
    }

    if (academicYear !== undefined) {
      updates.push(`academic_year = $${paramIdx++}`);
      values.push(typeof academicYear === 'string' ? academicYear.trim() : (academicYear || null));
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIdx++}`);
      values.push(typeof phone === 'string' ? phone.trim() : (phone || null));
    }

    if (cleanSocialLinks !== null) {
      updates.push(`social_links = $${paramIdx++}`);
      values.push(JSON.stringify(cleanSocialLinks));
    }

    updates.push('updated_at = NOW()');
    values.push(callerUserId);
    const callerIdParam = `$${paramIdx++}`;

    const updateRes = await query(
      `
        UPDATE users
        SET ${updates.join(',\n          ')}
        WHERE id = ${callerIdParam} AND is_active = TRUE
        RETURNING
          id,
          name,
          email,
          phone,
          avatar_url,
          membership_id,
          bio,
          university,
          faculty,
          department,
          academic_year,
          social_links,
          updated_at
      `,
      values
    );

    if (updateRes.rows.length === 0) {
      throw new HttpError(404, 'User profile not found');
    }

    const updatedUser = updateRes.rows[0];

    logger.info({
      event: 'user.profile.updated',
      userId: callerUserId,
      requestId: req.headers['x-request-id'],
    });

    const userSocials = updatedUser.social_links && typeof updatedUser.social_links === 'object' ? updatedUser.social_links : {};

    return res.json({
      ok: true,
      profile: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        avatarUrl: updatedUser.avatar_url,
        membershipId: updatedUser.membership_id,
        bio: updatedUser.bio || '',
        university: updatedUser.university || '',
        faculty: updatedUser.faculty || '',
        department: updatedUser.department || '',
        academicYear: updatedUser.academic_year || '',
        socialLinks: {
          github: userSocials.github || '',
          linkedin: userSocials.linkedin || '',
          website: userSocials.website || '',
        },
        updatedAt: updatedUser.updated_at,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      const detail = String(err.detail || err.message || '');
      if (detail.includes('membership_id') || err.constraint === 'idx_users_membership_id') {
        return next(new HttpError(409, 'An account with this IEEE Membership ID already exists.'));
      }
      return next(new HttpError(409, 'Duplicate value violates unique constraint.'));
    }
    return next(err);
  }
}

module.exports = {
  getUserProfile,
  updateMyPublicProfile,
};
