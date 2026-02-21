const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

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
        id,
        campaign_id,
        applicant_user_ref_id,
        answers,
        current_stage,
        submitted_at,
        created_at,
        updated_at
    `,
    [id, campaignId, applicantUserRefId, JSON.stringify(answers || {})]
  );

  return result.rows[0];
}

async function getApplicationById(applicationId) {
  const result = await query(
    `
      SELECT
        a.id,
        a.campaign_id,
        a.applicant_user_ref_id,
        a.answers,
        a.current_stage,
        a.submitted_at,
        a.created_at,
        a.updated_at,
        c.committee_id
      FROM hr_applications a
      JOIN hr_campaigns c ON c.id = a.campaign_id
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
        id,
        campaign_id,
        applicant_user_ref_id,
        answers,
        current_stage,
        submitted_at,
        created_at,
        updated_at
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
        a.id,
        a.campaign_id,
        a.applicant_user_ref_id,
        a.answers,
        a.current_stage,
        a.submitted_at,
        a.created_at,
        a.updated_at,
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

module.exports = {
  createApplication,
  getApplicationById,
  listApplications,
  updateApplicationStage,
};
