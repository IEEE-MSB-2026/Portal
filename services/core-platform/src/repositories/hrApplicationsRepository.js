const { randomUUID } = require('crypto');
const { getPool, query } = require('../db/pool');
const hrOnboardingRepository = require('./hrOnboardingRepository');

function mapApplicationColumns(prefix = null) {
  const q = prefix ? `${prefix}.` : '';
  return `
    ${q}id,
    ${q}campaign_id,
    ${q}committee_id,
    ${q}applicant_user_id,
    ${q}applicant_user_id AS applicant_user_ref_id,
    ${q}answers,
    ${q}current_stage,
    ${q}welcome_email_sent,
    ${q}welcome_email_sent_at,
    ${q}submitted_at,
    ${q}created_at,
    ${q}updated_at
  `;
}

async function createApplication({ campaignId, committeeId, applicantUserId, applicantUserRefId, answers }) {
  const id = randomUUID();
  const applicantId = applicantUserId || applicantUserRefId;

  const result = await query(
    `
      INSERT INTO hr_applications (
        id,
        campaign_id,
        committee_id,
        applicant_user_id,
        answers
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING
        ${mapApplicationColumns()}
    `,
    [id, campaignId, committeeId || null, applicantId, JSON.stringify(answers || {})]
  );

  return result.rows[0];
}

async function getApplicationById(applicationId) {
  const result = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        COALESCE(a.committee_id, c.committee_id) AS committee_id,
        c.title AS campaign_title,
        cc.name AS committee_name,
        u.id AS applicant_external_user_id,
        u.name AS applicant_name,
        u.email AS applicant_email
      FROM hr_applications a
      LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
      LEFT JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
      LEFT JOIN users u ON u.id = a.applicant_user_id
      WHERE a.id = $1
    `,
    [applicationId]
  );

  return result.rows[0] || null;
}

async function updateApplicationStage(applicationId, stage) {
  const result = await query(
    `
      UPDATE hr_applications
      SET current_stage = $2::hr_application_stage_type, updated_at = NOW()
      WHERE id = $1
      RETURNING
        ${mapApplicationColumns()}
    `,
    [applicationId, stage]
  );

  return result.rows[0] || null;
}

async function listApplications({
  committeeId,
  campaignId,
  stage = null,
  view = 'active',
  search = null,
  includeRejected = false,
  includeAccepted = false,
  limit = null,
  offset = 0,
}) {
  const values = [];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`(a.committee_id = $${values.length} OR (a.committee_id IS NULL AND c.committee_id = $${values.length}))`);
  }
  if (campaignId) {
    values.push(campaignId);
    where.push(`a.campaign_id = $${values.length}`);
  }

  // Stage & View filtering:
  if (stage) {
    values.push(stage);
    where.push(`a.current_stage = $${values.length}::hr_application_stage_type`);
  } else if (view === 'rejected') {
    where.push(`a.current_stage = 'rejected'`);
  } else if (view === 'accepted') {
    where.push(`a.current_stage = 'accepted'`);
  } else if (view === 'all') {
    // Return all stages without exclusion
  } else {
    // view === 'active' (default) or backward-compatible flags
    if (!includeRejected) {
      where.push(`a.current_stage != 'rejected'`);
    }
    if (!includeAccepted) {
      where.push(`a.current_stage != 'accepted'`);
    }
  }

  if (search && typeof search === 'string' && search.trim()) {
    values.push(`%${search.trim()}%`);
    const searchParam = `$${values.length}`;
    where.push(`(
      u.name ILIKE ${searchParam} OR
      u.email ILIKE ${searchParam} OR
      (a.answers->>'fullName') ILIKE ${searchParam} OR
      (a.answers->>'email') ILIKE ${searchParam} OR
      (a.answers->>'name') ILIKE ${searchParam} OR
      cc.name ILIKE ${searchParam}
    )`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM hr_applications a
      LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
      LEFT JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
      LEFT JOIN users u ON u.id = a.applicant_user_id
      ${whereClause}
    `,
    values
  );
  const total = countResult.rows[0]?.total || 0;

  let limitOffsetClause = '';
  const dataValues = [...values];
  if (limit !== null && limit !== undefined) {
    dataValues.push(limit);
    limitOffsetClause += ` LIMIT $${dataValues.length}`;
    if (offset && offset > 0) {
      dataValues.push(offset);
      limitOffsetClause += ` OFFSET $${dataValues.length}`;
    }
  } else if (offset && offset > 0) {
    dataValues.push(offset);
    limitOffsetClause += ` OFFSET $${dataValues.length}`;
  }

  const result = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        COALESCE(a.committee_id, c.committee_id) AS committee_id,
        c.title AS campaign_title,
        cc.name AS committee_name,
        u.id AS applicant_external_user_id,
        u.name AS applicant_name,
        u.email AS applicant_email,
        rej.rejection_notes,
        rej.rejected_at
      FROM hr_applications a
      LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
      LEFT JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
      LEFT JOIN users u ON u.id = a.applicant_user_id
      LEFT JOIN LATERAL (
        SELECT notes AS rejection_notes, created_at AS rejected_at
        FROM hr_application_stage_log
        WHERE application_id = a.id AND to_stage = 'rejected'
        ORDER BY created_at DESC
        LIMIT 1
      ) rej ON a.current_stage = 'rejected'
      ${whereClause}
      ORDER BY a.submitted_at DESC, a.id DESC
      ${limitOffsetClause}
    `,
    dataValues
  );

  return { rows: result.rows, total };
}

async function acceptApplicationWithChecklist({
  applicationId,
  actorUserId,
  actorUserRefId,
  notes,
  checklistItems = [],
  createChecklist = false,
}) {
  const actorId = actorUserId || actorUserRefId;
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
        SELECT
          ${mapApplicationColumns('a')},
          COALESCE(a.committee_id, c.committee_id) AS committee_id,
          c.title AS campaign_title,
          cc.name AS committee_name,
          u.id AS applicant_external_user_id,
          u.name AS applicant_name,
          u.email AS applicant_email
        FROM hr_applications a
        LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
        LEFT JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
        JOIN users u ON u.id = a.applicant_user_id
        WHERE a.id = $1
        FOR UPDATE OF a
      `,
      [applicationId]
    );

    const current = currentResult.rows[0] || null;
    if (!current) {
      await client.query('ROLLBACK');
      return { status: 'not_found', application: null, checklistItems: [] };
    }

    if (current.current_stage === 'accepted') {
      await client.query('COMMIT');
      return { status: 'already_accepted', application: current, checklistItems: [] };
    }

    if (current.current_stage !== 'final_review') {
      await client.query('ROLLBACK');
      return { status: 'invalid_transition', application: current, checklistItems: [] };
    }

    const updatedResult = await client.query(
      `
        UPDATE hr_applications
        SET current_stage = 'accepted', updated_at = NOW()
        WHERE id = $1
        RETURNING
          ${mapApplicationColumns()}
      `,
      [applicationId]
    );
    const updated = updatedResult.rows[0];

    await client.query(
      `
        INSERT INTO hr_application_stage_log (
          id,
          application_id,
          from_stage,
          to_stage,
          score,
          notes,
          actor_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        randomUUID(),
        applicationId,
        current.current_stage,
        'accepted',
        null,
        notes || null,
        actorId,
      ]
    );

    let createdChecklistItems = [];
    if (createChecklist && Array.isArray(checklistItems) && checklistItems.length > 0) {
      createdChecklistItems = await hrOnboardingRepository.createChecklistItems({
        applicationId,
        committeeId: current.committee_id,
        assigneeUserId: current.applicant_user_id,
        createdByUserRefId: actorId,
        checklistItems,
        client,
      });
    }

    await client.query(
      `
        INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee)
        VALUES ($1, $2, $3, 'member')
        ON CONFLICT (committee_id, user_id)
        DO NOTHING
      `,
      [randomUUID(), current.committee_id, current.applicant_user_id]
    );

    await client.query('COMMIT');

    return {
      status: 'accepted',
      application: {
        ...current,
        ...updated,
      },
      checklistItems: createdChecklistItems,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listApplicationsByApplicant(applicantUserId) {
  const result = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        COALESCE(a.committee_id, c.committee_id) AS committee_id,
        c.title AS campaign_title,
        cc.name AS committee_name,
        u.id AS applicant_external_user_id,
        u.name AS applicant_name,
        u.email AS applicant_email
      FROM hr_applications a
      JOIN hr_campaigns c ON c.id = a.campaign_id
      JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
      JOIN users u ON u.id = a.applicant_user_id
      WHERE a.applicant_user_id = $1
      ORDER BY a.submitted_at DESC, a.id DESC
    `,
    [applicantUserId]
  );

  return result.rows;
}

async function listOnboardingCandidates({
  committeeId,
  campaignId,
  welcomeEmailSent = 'false',
  search,
  limit = 100,
  offset = 0,
}) {
  const baseWhere = [`a.current_stage = 'accepted'`];
  const baseValues = [];

  if (committeeId) {
    baseValues.push(committeeId);
    baseWhere.push(`(a.committee_id = $${baseValues.length} OR (a.committee_id IS NULL AND c.committee_id = $${baseValues.length}))`);
  }
  if (campaignId) {
    baseValues.push(campaignId);
    baseWhere.push(`a.campaign_id = $${baseValues.length}`);
  }

  const baseWhereClause = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';

  // Summary counts across all accepted candidates matching committee/campaign filter
  const summaryResult = await query(
    `
      SELECT
        COUNT(*)::int AS "totalAccepted",
        COUNT(CASE WHEN a.welcome_email_sent IS NOT TRUE THEN 1 END)::int AS "unsentCount",
        COUNT(CASE WHEN a.welcome_email_sent IS TRUE THEN 1 END)::int AS "sentCount"
      FROM hr_applications a
      LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
      ${baseWhereClause}
    `,
    baseValues
  );

  const summary = summaryResult.rows[0] || { totalAccepted: 0, unsentCount: 0, sentCount: 0 };

  // Candidates query with welcomeEmailSent and search filters
  const values = [...baseValues];
  const queryWhere = [...baseWhere];

  const sentFilterStr = String(welcomeEmailSent).toLowerCase();
  if (sentFilterStr === 'false') {
    queryWhere.push(`(a.welcome_email_sent IS NOT TRUE)`);
  } else if (sentFilterStr === 'true') {
    queryWhere.push(`a.welcome_email_sent IS TRUE`);
  }

  if (search && search.trim()) {
    values.push(`%${search.trim()}%`);
    const searchParam = `$${values.length}`;
    queryWhere.push(`(
      u.name ILIKE ${searchParam} OR
      u.email ILIKE ${searchParam} OR
      (a.answers->>'fullName') ILIKE ${searchParam} OR
      (a.answers->>'name') ILIKE ${searchParam} OR
      (a.answers->>'email') ILIKE ${searchParam} OR
      cc.name ILIKE ${searchParam}
    )`);
  }

  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(offset);
  const offsetParam = `$${values.length}`;

  const candidatesWhereClause = queryWhere.length ? `WHERE ${queryWhere.join(' AND ')}` : '';

  const candidatesResult = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        COALESCE(a.committee_id, c.committee_id) AS committee_id,
        c.title AS campaign_title,
        cc.name AS committee_name,
        u.id AS applicant_external_user_id,
        u.name AS applicant_name,
        u.email AS applicant_email
      FROM hr_applications a
      LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
      LEFT JOIN committees cc ON cc.id = COALESCE(a.committee_id, c.committee_id)
      LEFT JOIN users u ON u.id = a.applicant_user_id
      ${candidatesWhereClause}
      ORDER BY a.submitted_at DESC, a.id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values
  );

  return {
    summary,
    candidates: candidatesResult.rows,
  };
}

async function markWelcomeEmailsSent(applicationIds = [], { checklistItems = [], actorUserRefId = null } = {}) {
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) return [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query(
      `
        UPDATE hr_applications
        SET
          welcome_email_sent = TRUE,
          welcome_email_sent_at = NOW(),
          updated_at = NOW()
        WHERE id = ANY($1::uuid[])
        RETURNING
          ${mapApplicationColumns()}
      `,
      [applicationIds]
    );

    if (Array.isArray(checklistItems) && checklistItems.length > 0) {
      const appsResult = await client.query(
        `
          SELECT
            a.id,
            COALESCE(a.committee_id, c.committee_id) AS committee_id,
            a.applicant_user_id
          FROM hr_applications a
          LEFT JOIN hr_campaigns c ON c.id = a.campaign_id
          WHERE a.id = ANY($1::uuid[])
        `,
        [applicationIds]
      );

      for (const app of appsResult.rows) {
        if (app.applicant_user_id && app.committee_id) {
          await hrOnboardingRepository.createChecklistItems({
            applicationId: app.id,
            committeeId: app.committee_id,
            assigneeUserId: app.applicant_user_id,
            createdByUserRefId: actorUserRefId,
            checklistItems,
            client,
          });
        }
      }
    }

    await client.query('COMMIT');
    return updateResult.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  acceptApplicationWithChecklist,
  createApplication,
  getApplicationById,
  listApplications,
  listApplicationsByApplicant,
  listOnboardingCandidates,
  markWelcomeEmailsSent,
  updateApplicationStage,
};

