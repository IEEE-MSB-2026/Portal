const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapCampaignColumns(prefix = 'c') {
  return `
    ${prefix}.id,
    ${prefix}.committee_id,
    ${prefix}.title,
    ${prefix}.subject,
    ${prefix}.body,
    ${prefix}.segment_type,
    ${prefix}.status,
    ${prefix}.scheduled_for,
    ${prefix}.dispatch_request_id,
    ${prefix}.recipient_count,
    ${prefix}.sent_count,
    ${prefix}.failed_count,
    ${prefix}.last_error,
    ${prefix}.created_by_user_id,
    ${prefix}.created_by_user_id AS created_by_user_ref_id,
    ${prefix}.updated_by_user_id,
    ${prefix}.updated_by_user_id AS updated_by_user_ref_id,
    ${prefix}.created_at,
    ${prefix}.updated_at,
    ${prefix}.sent_at,
    ${prefix}.failed_at
  `;
}

function mapCampaignSelect(prefix = 'c') {
  return `
    ${mapCampaignColumns(prefix)},
    cm.name AS committee_name,
    creator.name AS created_by_name,
    creator.id AS created_by_external_user_id,
    updater.id AS updated_by_external_user_id
  `;
}

async function getCampaignById(campaignId) {
  const result = await query(
    `
      SELECT
        ${mapCampaignSelect('c')}
      FROM pr_campaigns c
      LEFT JOIN committees cm ON cm.id = c.committee_id
      JOIN users creator ON creator.id = c.created_by_user_id
      LEFT JOIN users updater ON updater.id = c.updated_by_user_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [campaignId]
  );

  return result.rows[0] || null;
}

async function createCampaign({
  committeeId = null,
  title,
  subject,
  body,
  segmentType = 'all_members',
  status = 'draft',
  scheduledFor = null,
  createdByUserId,
  actorUserId,
  actorUserRefId,
}) {
  const campaignId = randomUUID();
  const targetCreatorId = createdByUserId || actorUserId || actorUserRefId;

  await query(
    `
      INSERT INTO pr_campaigns (
        id,
        committee_id,
        title,
        subject,
        body,
        segment_type,
        status,
        scheduled_for,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `,
    [
      campaignId,
      committeeId || null,
      title.trim(),
      subject.trim(),
      body.trim(),
      segmentType,
      status,
      scheduledFor,
      targetCreatorId,
    ]
  );

  return getCampaignById(campaignId);
}

async function listCampaigns({
  committeeId = null,
  status = null,
  segmentType = null,
  limit = 50,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    where.push(`c.status = $${values.length}`);
  }

  if (segmentType) {
    values.push(segmentType);
    where.push(`c.segment_type = $${values.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapCampaignSelect('c')}
      FROM pr_campaigns c
      LEFT JOIN committees cm ON cm.id = c.committee_id
      JOIN users creator ON creator.id = c.created_by_user_id
      LEFT JOIN users updater ON updater.id = c.updated_by_user_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    values
  );

  return result.rows;
}

async function listRecipientEmailsForSegment({ segmentType, committeeId = null }) {
  if (segmentType === 'committee_members') {
    if (!committeeId) return [];
    const result = await query(
      `
        SELECT DISTINCT u.email
        FROM committee_memberships cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.committee_id = $1 AND u.email IS NOT NULL AND u.is_active = TRUE
        ORDER BY u.email ASC
      `,
      [committeeId]
    );
    return result.rows.map((r) => r.email);
  }

  if (segmentType === 'committee_leads') {
    if (!committeeId) return [];
    const result = await query(
      `
        SELECT DISTINCT u.email
        FROM committee_memberships cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.committee_id = $1 AND cm.role_in_committee = 'lead' AND u.email IS NOT NULL AND u.is_active = TRUE
        ORDER BY u.email ASC
      `,
      [committeeId]
    );
    return result.rows.map((r) => r.email);
  }

  const result = await query(
    `
      SELECT DISTINCT email
      FROM users
      WHERE email IS NOT NULL AND is_active = TRUE
      ORDER BY email ASC
    `
  );
  return result.rows.map((r) => r.email);
}

async function markCampaignSending({ campaignId, dispatchRequestId, actorUserId, actorUserRefId }) {
  const updaterId = actorUserId || actorUserRefId;
  const result = await query(
    `
      UPDATE pr_campaigns
      SET
        status = 'sending',
        dispatch_request_id = $2,
        updated_by_user_id = $3,
        updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'scheduled', 'failed')
      RETURNING id
    `,
    [campaignId, dispatchRequestId, updaterId]
  );

  if (!result.rows[0]) return null;
  return getCampaignById(campaignId);
}

async function markCampaignSent({
  campaignId,
  dispatchRequestId,
  recipientCount,
  sentCount,
  failedCount,
  actorUserId,
  actorUserRefId,
}) {
  const updaterId = actorUserId || actorUserRefId;
  const result = await query(
    `
      UPDATE pr_campaigns
      SET
        status = 'sent',
        dispatch_request_id = $2,
        recipient_count = $3,
        sent_count = $4,
        failed_count = $5,
        last_error = NULL,
        sent_at = NOW(),
        updated_by_user_id = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [campaignId, dispatchRequestId, recipientCount, sentCount, failedCount, updaterId]
  );

  if (!result.rows[0]) return null;
  return getCampaignById(campaignId);
}

async function markCampaignFailed({
  campaignId,
  dispatchRequestId,
  recipientCount,
  sentCount,
  failedCount,
  error,
  actorUserId,
  actorUserRefId,
}) {
  const updaterId = actorUserId || actorUserRefId;
  const result = await query(
    `
      UPDATE pr_campaigns
      SET
        status = 'failed',
        dispatch_request_id = $2,
        recipient_count = $3,
        sent_count = $4,
        failed_count = $5,
        last_error = $6,
        failed_at = NOW(),
        updated_by_user_id = $7,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [campaignId, dispatchRequestId, recipientCount, sentCount, failedCount, error || null, updaterId]
  );

  if (!result.rows[0]) return null;
  return getCampaignById(campaignId);
}

async function createDispatchLog({
  campaignId,
  dispatchRequestId,
  status,
  recipientCount = 0,
  sentCount = 0,
  failedCount = 0,
  error = null,
}) {
  const logId = randomUUID();
  await query(
    `
      INSERT INTO pr_campaign_dispatch_log (
        id,
        campaign_id,
        dispatch_request_id,
        status,
        recipient_count,
        sent_count,
        failed_count,
        error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [logId, campaignId, dispatchRequestId, status, recipientCount, sentCount, failedCount, error || null]
  );
}

async function listDispatchLogsByCampaign(campaignId) {
  const result = await query(
    `
      SELECT
        id,
        campaign_id,
        dispatch_request_id,
        status,
        recipient_count,
        sent_count,
        failed_count,
        error,
        created_at
      FROM pr_campaign_dispatch_log
      WHERE campaign_id = $1
      ORDER BY created_at DESC
    `,
    [campaignId]
  );
  return result.rows;
}

module.exports = {
  createCampaign,
  createDispatchLog,
  getCampaignById,
  listCampaigns,
  listDispatchLogsByCampaign,
  listRecipientEmailsForSegment,
  markCampaignFailed,
  markCampaignSending,
  markCampaignSent,
};
