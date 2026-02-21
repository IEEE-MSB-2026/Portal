const { randomUUID } = require('crypto');
const { getPool, query } = require('../db/pool');
const hrOnboardingRepository = require('./hrOnboardingRepository');

function mapApplicationColumns(prefix = null) {
  const qualifier = prefix ? `${prefix}.` : '';
  return `
    ${qualifier}id,
    ${qualifier}campaign_id,
    ${qualifier}applicant_user_ref_id,
    ${qualifier}answers,
    ${qualifier}current_stage,
    ${qualifier}submitted_at,
    ${qualifier}created_at,
    ${qualifier}updated_at
  `;
}

async function createApplication({ campaignId, applicantUserRefId, answers }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO hr_applications (
        id,
        campaign_id,
        applicant_user_ref_id,
        answers
      )
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING
        ${mapApplicationColumns()}
    `,
    [id, campaignId, applicantUserRefId, JSON.stringify(answers || {})]
  );

  return result.rows[0];
}

async function getApplicationById(applicationId) {
  const result = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        c.committee_id,
        c.title AS campaign_title,
        u.external_user_id AS applicant_external_user_id,
        u.email AS applicant_email
      FROM hr_applications a
      JOIN hr_campaigns c ON c.id = a.campaign_id
      JOIN users_ref u ON u.id = a.applicant_user_ref_id
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
      SET current_stage = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        ${mapApplicationColumns()}
    `,
    [applicationId, stage]
  );

  return result.rows[0] || null;
}

async function listApplications({ committeeId, campaignId, limit = 50 }) {
  const values = [limit];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  }
  if (campaignId) {
    values.push(campaignId);
    where.push(`a.campaign_id = $${values.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapApplicationColumns('a')},
        c.committee_id,
        c.title AS campaign_title,
        u.external_user_id AS applicant_external_user_id,
        u.email AS applicant_email
      FROM hr_applications a
      JOIN hr_campaigns c ON c.id = a.campaign_id
      JOIN users_ref u ON u.id = a.applicant_user_ref_id
      ${whereClause}
      ORDER BY a.submitted_at DESC, a.id DESC
      LIMIT $1
    `,
    values
  );

  return result.rows;
}

async function acceptApplicationWithChecklist({
  applicationId,
  actorUserRefId,
  notes,
  checklistItems,
}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
        SELECT
          ${mapApplicationColumns('a')},
          c.committee_id,
          c.title AS campaign_title,
          cc.name AS committee_name,
          u.external_user_id AS applicant_external_user_id,
          u.email AS applicant_email
        FROM hr_applications a
        JOIN hr_campaigns c ON c.id = a.campaign_id
        JOIN committees cc ON cc.id = c.committee_id
        JOIN users_ref u ON u.id = a.applicant_user_ref_id
        WHERE a.id = $1
        FOR UPDATE
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
          actor_user_ref_id
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
        actorUserRefId,
      ]
    );

    const createdChecklistItems = await hrOnboardingRepository.createChecklistItems({
      applicationId,
      committeeId: current.committee_id,
      assigneeUserRefId: current.applicant_user_ref_id,
      createdByUserRefId: actorUserRefId,
      checklistItems,
      client,
    });

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

module.exports = {
  acceptApplicationWithChecklist,
  createApplication,
  getApplicationById,
  listApplications,
  updateApplicationStage,
};
