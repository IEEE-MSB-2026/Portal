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
    ${prefix}.created_by_user_ref_id,
    ${prefix}.updated_by_user_ref_id,
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
    creator.external_user_id AS created_by_external_user_id,
    updater.external_user_id AS updated_by_external_user_id
  `;
}

async function getCampaignById(campaignId) {
  const result = await query(
    `
      SELECT
        ${mapCampaignSelect('c')}
      FROM pr_campaigns c
      LEFT JOIN committees cm ON cm.id = c.committee_id
      JOIN users_ref creator ON creator.id = c.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = c.updated_by_user_ref_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [campaignId]
  );

  return result.rows[0] || null;
}

async function createCampaign({
  committeeId,
  title,
  subject,
  body,
  segmentType,
  status,
  scheduledFor,
  actorUserRefId,
}) {
  const campaignId = randomUUID();

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
        created_by_user_ref_id,
        updated_by_user_ref_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `,
    [
      campaignId,
      committeeId || null,
      title,
      subject,
      body,
      segmentType,
      status,
      scheduledFor || null,
      actorUserRefId,
    ]
  );

  return getCampaignById(campaignId);
}

async function listCampaigns({ committeeId = null, committeeIds = null, limit = 50 }) {
  const values = [limit];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  } else if (Array.isArray(committeeIds)) {
    if (!committeeIds.length) return [];
    const placeholders = committeeIds.map((_, index) => `$${values.length + index + 1}`);
    values.push(...committeeIds);
    where.push(`c.committee_id IN (${placeholders.join(', ')})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await query(
    `
      SELECT
        ${mapCampaignSelect('c')}
      FROM pr_campaigns c
      LEFT JOIN committees cm ON cm.id = c.committee_id
      JOIN users_ref creator ON creator.id = c.created_by_user_ref_id
      JOIN users_ref updater ON updater.id = c.updated_by_user_ref_id
      ${whereClause}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $1
    `,
    values
  );

  return result.rows;
}

async function markCampaignSent({
  campaignId,
  dispatchRequestId,
  recipientCount,
  sentCount,
  failedCount,
  actorUserRefId,
}) {
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
        failed_at = NULL,
        updated_by_user_ref_id = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [campaignId, dispatchRequestId, recipientCount, sentCount, failedCount, actorUserRefId]
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
  errorMessage,
  actorUserRefId,
}) {
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
        updated_by_user_ref_id = $7,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [
      campaignId,
      dispatchRequestId,
      recipientCount,
      sentCount,
      failedCount,
      errorMessage || null,
      actorUserRefId,
    ]
  );

  if (!result.rows[0]) return null;
  return getCampaignById(campaignId);
}

async function createDispatchLog({
  campaignId,
  dispatchRequestId,
  actorUserRefId,
  status,
  recipientCount,
  sentCount,
  failedCount,
  errorMessage,
}) {
  await query(
    `
      INSERT INTO pr_campaign_dispatch_log (
        id,
        campaign_id,
        dispatch_request_id,
        actor_user_ref_id,
        status,
        recipient_count,
        sent_count,
        failed_count,
        error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      randomUUID(),
      campaignId,
      dispatchRequestId,
      actorUserRefId,
      status,
      recipientCount || 0,
      sentCount || 0,
      failedCount || 0,
      errorMessage || null,
    ]
  );
}

async function listDispatchLogsByCampaign(campaignId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT
        l.id,
        l.campaign_id,
        l.dispatch_request_id,
        l.status,
        l.recipient_count,
        l.sent_count,
        l.failed_count,
        l.error_message,
        l.created_at,
        actor.external_user_id AS actor_external_user_id
      FROM pr_campaign_dispatch_log l
      JOIN users_ref actor ON actor.id = l.actor_user_ref_id
      WHERE l.campaign_id = $1
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2
    `,
    [campaignId, limit]
  );

  return result.rows;
}

async function listRecipientEmailsForSegment({ segmentType, committeeId }) {
  if (segmentType === 'all_members') {
    const result = await query(
      `
        SELECT DISTINCT ur.email
        FROM committee_memberships cm
        JOIN users_ref ur ON ur.id = cm.user_ref_id
        ORDER BY ur.email ASC
      `
    );
    return result.rows.map((row) => row.email);
  }

  if (segmentType === 'committee_members') {
    const result = await query(
      `
        SELECT DISTINCT ur.email
        FROM committee_memberships cm
        JOIN users_ref ur ON ur.id = cm.user_ref_id
        WHERE cm.committee_id = $1
        ORDER BY ur.email ASC
      `,
      [committeeId]
    );
    return result.rows.map((row) => row.email);
  }

  if (segmentType === 'committee_leads') {
    const result = await query(
      `
        SELECT DISTINCT ur.email
        FROM committee_memberships cm
        JOIN users_ref ur ON ur.id = cm.user_ref_id
        WHERE cm.committee_id = $1
          AND cm.role_in_committee = 'lead'
        ORDER BY ur.email ASC
      `,
      [committeeId]
    );
    return result.rows.map((row) => row.email);
  }

  return [];
}

module.exports = {
  createCampaign,
  createDispatchLog,
  getCampaignById,
  listCampaigns,
  listDispatchLogsByCampaign,
  listRecipientEmailsForSegment,
  markCampaignFailed,
  markCampaignSent,
};
