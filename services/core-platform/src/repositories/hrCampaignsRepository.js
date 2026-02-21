const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createCampaign({
  committeeId,
  title,
  description,
  opensAt,
  closesAt,
  status,
  formSchema,
  createdByUserRefId,
}) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO hr_campaigns (
        id,
        committee_id,
        title,
        description,
        opens_at,
        closes_at,
        status,
        form_schema,
        created_by_user_ref_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      RETURNING
        id,
        committee_id,
        title,
        description,
        opens_at,
        closes_at,
        status,
        form_schema,
        created_by_user_ref_id,
        created_at,
        updated_at
    `,
    [
      id,
      committeeId,
      title,
      description || null,
      opensAt,
      closesAt,
      status,
      JSON.stringify(formSchema || {}),
      createdByUserRefId,
    ]
  );

  return result.rows[0];
}

async function getCampaignById(campaignId) {
  const result = await query(
    `
      SELECT
        id,
        committee_id,
        title,
        description,
        opens_at,
        closes_at,
        status,
        form_schema,
        created_by_user_ref_id,
        created_at,
        updated_at
      FROM hr_campaigns
      WHERE id = $1
    `,
    [campaignId]
  );

  return result.rows[0] || null;
}

async function updateCampaignStatus(campaignId, status) {
  const result = await query(
    `
      UPDATE hr_campaigns
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        committee_id,
        title,
        description,
        opens_at,
        closes_at,
        status,
        form_schema,
        created_by_user_ref_id,
        created_at,
        updated_at
    `,
    [campaignId, status]
  );

  return result.rows[0] || null;
}

module.exports = {
  createCampaign,
  getCampaignById,
  updateCampaignStatus,
};
