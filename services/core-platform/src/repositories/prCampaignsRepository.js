const { randomUUID } = require('crypto');
const { query, getPool } = require('../db/pool');

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
    ${prefix}.recipient_user_ids,
    ${prefix}.custom_recipients,
    ${prefix}.metadata,
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
      LEFT JOIN users creator ON creator.id = c.created_by_user_id
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
  recipientUserIds = [],
  customRecipients = [],
  metadata = {},
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
        recipient_user_ids,
        custom_recipients,
        metadata,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
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
      JSON.stringify(recipientUserIds || []),
      JSON.stringify(customRecipients || []),
      JSON.stringify(metadata || {}),
      targetCreatorId,
    ]
  );

  return getCampaignById(campaignId);
}

async function updateCampaign({
  campaignId,
  committeeId,
  title,
  subject,
  body,
  segmentType,
  status,
  scheduledFor,
  recipientUserIds,
  customRecipients,
  metadata,
  actorUserId,
  actorUserRefId,
}) {
  const updaterId = actorUserId || actorUserRefId;
  const updates = ['updated_at = NOW()'];
  const values = [campaignId];

  if (title !== undefined) {
    values.push(title.trim());
    updates.push(`title = $${values.length}`);
  }
  if (subject !== undefined) {
    values.push(subject.trim());
    updates.push(`subject = $${values.length}`);
  }
  if (body !== undefined) {
    values.push(body.trim());
    updates.push(`body = $${values.length}`);
  }
  if (segmentType !== undefined) {
    values.push(segmentType);
    updates.push(`segment_type = $${values.length}`);
  }
  if (committeeId !== undefined) {
    values.push(committeeId || null);
    updates.push(`committee_id = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    updates.push(`status = $${values.length}`);
  }
  if (scheduledFor !== undefined) {
    values.push(scheduledFor);
    updates.push(`scheduled_for = $${values.length}`);
  }
  if (recipientUserIds !== undefined) {
    values.push(JSON.stringify(recipientUserIds || []));
    updates.push(`recipient_user_ids = $${values.length}`);
  }
  if (customRecipients !== undefined) {
    values.push(JSON.stringify(customRecipients || []));
    updates.push(`custom_recipients = $${values.length}`);
  }
  if (metadata !== undefined) {
    values.push(JSON.stringify(metadata || {}));
    updates.push(`metadata = $${values.length}`);
  }
  if (updaterId) {
    values.push(updaterId);
    updates.push(`updated_by_user_id = $${values.length}`);
  }

  await query(
    `
      UPDATE pr_campaigns
      SET ${updates.join(', ')}
      WHERE id = $1
    `,
    values
  );

  return getCampaignById(campaignId);
}

async function deleteCampaign(campaignId) {
  const result = await query(
    `DELETE FROM pr_campaigns WHERE id = $1 RETURNING id`,
    [campaignId]
  );
  return Boolean(result.rows[0]);
}

async function listCampaigns({
  committeeId = null,
  committeeIds = null,
  status = null,
  includeArchived = false,
  segmentType = null,
  category = null,
  includeHr = false,
  limit = 50,
  offset = 0,
} = {}) {
  const values = [limit, offset];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  } else if (Array.isArray(committeeIds) && committeeIds.length > 0) {
    values.push(committeeIds);
    where.push(`(c.committee_id = ANY($${values.length}) OR c.committee_id IS NULL)`);
  }

  if (status) {
    values.push(status);
    where.push(`c.status = $${values.length}`);
  } else if (!includeArchived) {
    where.push(`c.status != 'archived'`);
  }

  if (segmentType) {
    values.push(segmentType);
    where.push(`c.segment_type = $${values.length}`);
  }

  // Category filtering for automated HR outreach vs standard PR campaigns
  if (category === 'hr_outreach' || category === 'hr') {
    where.push(`c.metadata->>'category' = 'hr_outreach'`);
  } else if (category === 'pr') {
    where.push(`(c.metadata->>'category' IS DISTINCT FROM 'hr_outreach')`);
  } else if (!includeHr && category !== 'all') {
    // Default: exclude automated HR outreach campaigns from standard PR lists
    where.push(`(c.metadata->>'category' IS DISTINCT FROM 'hr_outreach')`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
      SELECT
        ${mapCampaignSelect('c')}
      FROM pr_campaigns c
      LEFT JOIN committees cm ON cm.id = c.committee_id
      LEFT JOIN users creator ON creator.id = c.created_by_user_id
      LEFT JOIN users updater ON updater.id = c.updated_by_user_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    values
  );

  return result.rows;
}

async function archiveCampaign(campaignId, actorUserId) {
  const existing = await getCampaignById(campaignId);
  if (!existing) return null;

  let metadata = {};
  try {
    if (typeof existing.metadata === 'string') {
      metadata = JSON.parse(existing.metadata);
    } else if (typeof existing.metadata === 'object' && existing.metadata !== null) {
      metadata = { ...existing.metadata };
    }
  } catch {
    metadata = {};
  }

  metadata.archivedFromStatus = existing.status;
  metadata.archivedAt = new Date().toISOString();

  return updateCampaign({
    campaignId,
    status: 'archived',
    metadata,
    actorUserId,
  });
}

async function unarchiveCampaign(campaignId, actorUserId) {
  const existing = await getCampaignById(campaignId);
  if (!existing) return null;

  let metadata = {};
  try {
    if (typeof existing.metadata === 'string') {
      metadata = JSON.parse(existing.metadata);
    } else if (typeof existing.metadata === 'object' && existing.metadata !== null) {
      metadata = { ...existing.metadata };
    }
  } catch {
    metadata = {};
  }

  const targetStatus = metadata.archivedFromStatus && metadata.archivedFromStatus !== 'archived'
    ? metadata.archivedFromStatus
    : 'draft';

  delete metadata.archivedFromStatus;
  delete metadata.archivedAt;

  return updateCampaign({
    campaignId,
    status: targetStatus,
    metadata,
    actorUserId,
  });
}

async function duplicateCampaign(campaignId, actorUserId) {
  const source = await getCampaignById(campaignId);
  if (!source) return null;

  let parsedRecipientUserIds = [];
  try {
    if (typeof source.recipient_user_ids === 'string') {
      parsedRecipientUserIds = JSON.parse(source.recipient_user_ids);
    } else if (Array.isArray(source.recipient_user_ids)) {
      parsedRecipientUserIds = source.recipient_user_ids;
    }
  } catch {
    parsedRecipientUserIds = [];
  }

  let parsedCustomRecipients = [];
  try {
    if (typeof source.custom_recipients === 'string') {
      parsedCustomRecipients = JSON.parse(source.custom_recipients);
    } else if (Array.isArray(source.custom_recipients)) {
      parsedCustomRecipients = source.custom_recipients;
    }
  } catch {
    parsedCustomRecipients = [];
  }

  let parsedMetadata = {};
  try {
    if (typeof source.metadata === 'string') {
      parsedMetadata = JSON.parse(source.metadata);
    } else if (typeof source.metadata === 'object' && source.metadata !== null) {
      parsedMetadata = { ...source.metadata };
    }
  } catch {
    parsedMetadata = {};
  }

  delete parsedMetadata.archivedFromStatus;
  delete parsedMetadata.archivedAt;

  return createCampaign({
    committeeId: source.committee_id,
    title: `${source.title} (Copy)`,
    subject: source.subject,
    body: source.body,
    segmentType: source.segment_type,
    status: 'draft',
    scheduledFor: null,
    recipientUserIds: parsedRecipientUserIds,
    customRecipients: parsedCustomRecipients,
    metadata: parsedMetadata,
    actorUserId,
  });
}

/**
 * Resolves detailed recipient records with context data for dynamic templating
 */
async function listRecipientsForSegment({
  segmentType,
  committeeId = null,
  recipientUserIds = [],
  customRecipients = [],
}) {
  if ((segmentType === 'custom_sheet' || segmentType === 'custom' || segmentType === 'event_attendees') && Array.isArray(customRecipients)) {
    return customRecipients
      .filter((r) => r && (r.email || r['user.email'] || r.Email || r['E-mail']))
      .map((r) => {
        const rawEmail = r.email || r['user.email'] || r.Email || r['E-mail'] || '';
        const name = r.name || r['user.name'] || r.Name || r['Full Name'] || 'Member';
        const committeeName = r.committee || r.committeeName || r['user.committee'] || r.Committee || '';

        // Extract flattened custom fields without double-nesting
        let customFields = {};
        if (r.customFields && typeof r.customFields === 'object') {
          customFields = { ...r.customFields };
          if (customFields.customFields && typeof customFields.customFields === 'object') {
            customFields = { ...customFields, ...customFields.customFields };
            delete customFields.customFields;
          }
        } else {
          customFields = { ...r };
        }
        delete customFields.customFields;

        const attachments = Array.isArray(r.attachments)
          ? r.attachments
          : (Array.isArray(customFields.attachments) ? customFields.attachments : []);

        return {
          userId: r.userId || null,
          email: String(rawEmail).trim().toLowerCase(),
          name: String(name).trim(),
          committeeName: String(committeeName).trim(),
          role: r.role || 'recipient',
          participantId: r.participantId || customFields.participantId || null,
          customFields,
          attachments,
        };
      });
  }

  if (segmentType === 'specific_members' && Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
    const result = await query(
      `
        SELECT DISTINCT
          u.id AS user_id,
          u.email,
          u.name,
          cm_table.name AS committee_name,
          COALESCE(mem.role_in_committee::text, u.default_role, 'member') AS role
        FROM users u
        LEFT JOIN committee_memberships mem ON mem.user_id = u.id
        LEFT JOIN committees cm_table ON cm_table.id = mem.committee_id
        WHERE u.id = ANY($1) AND u.email IS NOT NULL AND u.is_active = TRUE
        ORDER BY u.name ASC
      `,
      [recipientUserIds]
    );

    return result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email.toLowerCase(),
      name: r.name || 'Member',
      committeeName: r.committee_name || 'IEEE Menoufia SB',
      role: r.role || 'member',
      customFields: {},
    }));
  }

  if (segmentType === 'committee_members') {
    if (!committeeId) return [];
    const result = await query(
      `
        SELECT DISTINCT
          u.id AS user_id,
          u.email,
          u.name,
          cm.name AS committee_name,
          mem.role_in_committee::text AS role
        FROM committee_memberships mem
        JOIN users u ON u.id = mem.user_id
        JOIN committees cm ON cm.id = mem.committee_id
        WHERE mem.committee_id = $1 AND u.email IS NOT NULL AND u.is_active = TRUE
        ORDER BY u.name ASC
      `,
      [committeeId]
    );

    return result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email.toLowerCase(),
      name: r.name || 'Member',
      committeeName: r.committee_name || 'Committee',
      role: r.role || 'member',
      customFields: {},
    }));
  }

  if (segmentType === 'committee_leads' || segmentType === 'committee_leads_specific' || segmentType === 'committee_leads_all') {
    if (committeeId && segmentType !== 'committee_leads_all') {
      const result = await query(
        `
          SELECT DISTINCT
            u.id AS user_id,
            u.email,
            u.name,
            cm.name AS committee_name,
            mem.role_in_committee::text AS role
          FROM committee_memberships mem
          JOIN users u ON u.id = mem.user_id
          JOIN committees cm ON cm.id = mem.committee_id
          WHERE mem.committee_id = $1 AND mem.role_in_committee = 'lead' AND u.email IS NOT NULL AND u.is_active = TRUE
          ORDER BY u.name ASC
        `,
        [committeeId]
      );

      return result.rows.map((r) => ({
        userId: r.user_id,
        email: r.email.toLowerCase(),
        name: r.name || 'Committee Lead',
        committeeName: r.committee_name || 'Committee',
        role: 'lead',
        customFields: {},
      }));
    }

    // Leads of ALL committees
    const result = await query(
      `
        SELECT DISTINCT
          u.id AS user_id,
          u.email,
          u.name,
          cm.name AS committee_name,
          mem.role_in_committee::text AS role
        FROM committee_memberships mem
        JOIN users u ON u.id = mem.user_id
        JOIN committees cm ON cm.id = mem.committee_id
        WHERE mem.role_in_committee = 'lead' AND u.email IS NOT NULL AND u.is_active = TRUE
        ORDER BY u.name ASC
      `
    );

    return result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email.toLowerCase(),
      name: r.name || 'Committee Lead',
      committeeName: r.committee_name || 'Executive Committee',
      role: 'lead',
      customFields: {},
    }));
  }

  // Default: all_members
  const result = await query(
    `
      SELECT DISTINCT
        u.id AS user_id,
        u.email,
        u.name,
        COALESCE(cm.name, 'IEEE Menoufia SB') AS committee_name,
        COALESCE(mem.role_in_committee::text, u.default_role, 'member') AS role
      FROM users u
      LEFT JOIN committee_memberships mem ON mem.user_id = u.id
      LEFT JOIN committees cm ON cm.id = mem.committee_id
      WHERE u.email IS NOT NULL AND u.is_active = TRUE
      ORDER BY u.name ASC
    `
  );

  return result.rows.map((r) => ({
    userId: r.user_id,
    email: r.email.toLowerCase(),
    name: r.name || 'Member',
    committeeName: r.committee_name || 'IEEE Menoufia SB',
    role: r.role || 'member',
    customFields: {},
  }));
}

/**
 * Backward compatibility helper for email-only lists
 */
async function listRecipientEmailsForSegment({ segmentType, committeeId = null }) {
  const recipients = await listRecipientsForSegment({ segmentType, committeeId });
  return recipients.map((r) => r.email);
}

/**
 * Atomic Compare-And-Swap (CAS) to lock campaign for sending
 */
async function claimCampaignForSending(campaignId, dispatchRequestId, actorUserId) {
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
    [campaignId, dispatchRequestId, actorUserId || null]
  );

  if (!result.rows[0]) return null;
  return getCampaignById(campaignId);
}

/**
 * Claims due scheduled campaigns with SKIP LOCKED to prevent multi-instance race conditions
 */
async function claimDueScheduledCampaigns({ limit = 10 } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectResult = await client.query(
      `
        SELECT id
        FROM pr_campaigns
        WHERE status = 'scheduled' AND scheduled_for <= NOW()
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [limit]
    );

    if (selectResult.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const campaignIds = selectResult.rows.map((r) => r.id);
    const dispatchRequestId = randomUUID();

    await client.query(
      `
        UPDATE pr_campaigns
        SET
          status = 'sending',
          dispatch_request_id = $2,
          updated_at = NOW()
        WHERE id = ANY($1)
      `,
      [campaignIds, dispatchRequestId]
    );

    const result = await client.query(
      `
        SELECT
          ${mapCampaignSelect('c')}
        FROM pr_campaigns c
        LEFT JOIN committees cm ON cm.id = c.committee_id
        LEFT JOIN users creator ON creator.id = c.created_by_user_id
        LEFT JOIN users updater ON updater.id = c.updated_by_user_id
        WHERE c.id = ANY($1)
        ORDER BY c.scheduled_for ASC
      `,
      [campaignIds]
    );

    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
    [campaignId, dispatchRequestId, recipientCount, sentCount, failedCount, updaterId || null]
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
    [campaignId, dispatchRequestId, recipientCount, sentCount, failedCount, error || null, updaterId || null]
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
  logs = [],
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
        error,
        logs
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      logId,
      campaignId,
      dispatchRequestId,
      status,
      recipientCount,
      sentCount,
      failedCount,
      error || null,
      JSON.stringify(logs || []),
    ]
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
        logs,
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
  updateCampaign,
  deleteCampaign,
  archiveCampaign,
  unarchiveCampaign,
  duplicateCampaign,
  createDispatchLog,
  getCampaignById,
  listCampaigns,
  listDispatchLogsByCampaign,
  listRecipientsForSegment,
  listRecipientEmailsForSegment,
  claimCampaignForSending,
  claimDueScheduledCampaigns,
  markCampaignFailed,
  markCampaignSent,
};
