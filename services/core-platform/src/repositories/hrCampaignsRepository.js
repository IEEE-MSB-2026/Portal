const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function syncCampaignCommittees(campaignId, committeeIds = []) {
  if (!committeeIds || !committeeIds.length) return;
  for (const cId of committeeIds) {
    await query(
      `
        INSERT INTO hr_campaign_committees (campaign_id, committee_id)
        VALUES ($1, $2)
        ON CONFLICT (campaign_id, committee_id) DO NOTHING
      `,
      [campaignId, cId]
    );
  }
}

async function createCampaign({
  committeeId,
  committeeIds = [],
  title,
  description,
  opensAt,
  closesAt,
  status = 'draft',
  formSchema = {},
  createdByUserId,
  createdByUserRefId,
}) {
  const id = randomUUID();
  const creatorId = createdByUserId || createdByUserRefId;
  const targetCommittees = committeeIds.length > 0 ? committeeIds : (committeeId ? [committeeId] : []);
  const primaryCommitteeId = targetCommittees[0] || committeeId || null;

  await query(
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
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    `,
    [
      id,
      primaryCommitteeId,
      title.trim(),
      description ? description.trim() : null,
      opensAt,
      closesAt,
      status,
      JSON.stringify(formSchema || {}),
      creatorId,
    ]
  );

  await syncCampaignCommittees(id, targetCommittees);
  return getCampaignById(id);
}

async function updateCampaign(campaignId, {
  title,
  description,
  opensAt,
  closesAt,
  status,
  committeeIds,
}) {
  const fields = [];
  const values = [campaignId];

  if (title !== undefined) {
    values.push(title.trim());
    fields.push(`title = $${values.length}`);
  }
  if (description !== undefined) {
    values.push(description ? description.trim() : null);
    fields.push(`description = $${values.length}`);
  }
  if (opensAt !== undefined) {
    values.push(opensAt);
    fields.push(`opens_at = $${values.length}`);
  }
  if (closesAt !== undefined) {
    values.push(closesAt);
    fields.push(`closes_at = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    fields.push(`status = $${values.length}`);
  }

  if (fields.length > 0) {
    fields.push('updated_at = NOW()');
    await query(
      `
        UPDATE hr_campaigns
        SET ${fields.join(', ')}
        WHERE id = $1
      `,
      values
    );
  }

  if (Array.isArray(committeeIds)) {
    await query('DELETE FROM hr_campaign_committees WHERE campaign_id = $1', [campaignId]);
    await syncCampaignCommittees(campaignId, committeeIds);
    if (committeeIds.length > 0) {
      await query('UPDATE hr_campaigns SET committee_id = $2 WHERE id = $1', [campaignId, committeeIds[0]]);
    }
  }

  return getCampaignById(campaignId);
}

async function getCampaignById(campaignId) {
  const result = await query(
    `
      SELECT
        c.id,
        c.committee_id,
        c.title,
        c.description,
        c.opens_at,
        c.closes_at,
        c.status,
        c.form_schema,
        c.created_by_user_id,
        c.created_by_user_id AS created_by_user_ref_id,
        c.created_at,
        c.updated_at,
        COALESCE(
          json_agg(
            json_build_object('id', cm.id, 'slug', cm.slug, 'name', cm.name)
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::json
        ) AS committees
      FROM hr_campaigns c
      LEFT JOIN hr_campaign_committees hcc ON hcc.campaign_id = c.id
      LEFT JOIN committees cm ON cm.id = hcc.committee_id OR (hcc.committee_id IS NULL AND cm.id = c.committee_id)
      WHERE c.id = $1
      GROUP BY c.id
    `,
    [campaignId]
  );

  return result.rows[0] || null;
}

async function updateCampaignStatus(campaignId, status) {
  await query(
    `
      UPDATE hr_campaigns
      SET status = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [campaignId, status]
  );

  return getCampaignById(campaignId);
}

async function listCampaigns({ committeeId = null, status = null } = {}) {
  const values = [];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`(
      EXISTS (
        SELECT 1 FROM hr_campaign_committees hcc2
        WHERE hcc2.campaign_id = c.id AND hcc2.committee_id = $${values.length}
      )
      OR c.committee_id = $${values.length}
    )`);
  }
  if (status) {
    values.push(status);
    where.push(`c.status = $${values.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        c.id,
        c.committee_id,
        c.title,
        c.description,
        c.opens_at,
        c.closes_at,
        c.status,
        c.form_schema,
        c.created_by_user_id,
        c.created_by_user_id AS created_by_user_ref_id,
        c.created_at,
        c.updated_at,
        COALESCE(
          json_agg(
            json_build_object('id', cm.id, 'slug', cm.slug, 'name', cm.name)
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::json
        ) AS committees
      FROM hr_campaigns c
      LEFT JOIN hr_campaign_committees hcc ON hcc.campaign_id = c.id
      LEFT JOIN committees cm ON cm.id = hcc.committee_id OR (hcc.committee_id IS NULL AND cm.id = c.committee_id)
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `,
    values
  );

  return result.rows;
}

module.exports = {
  createCampaign,
  updateCampaign,
  getCampaignById,
  listCampaigns,
  updateCampaignStatus,
};
