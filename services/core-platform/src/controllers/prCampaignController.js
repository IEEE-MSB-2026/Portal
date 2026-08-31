const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const prCampaignDispatchService = require('../services/prCampaignDispatchService');
const committeesRepository = require('../repositories/committeesRepository');
const prCampaignsRepository = require('../repositories/prCampaignsRepository');

const ALLOWED_SEGMENTS = new Set([
  'all_members',
  'committee_members',
  'committee_leads',
  'specific_members',
  'custom_sheet',
]);
const ALLOWED_CREATE_STATUSES = new Set(['draft', 'scheduled']);

function parseDateTime(name, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${name} must be a valid ISO date-time`);
  }
  return parsed.toISOString();
}

function toCampaignResponse(row) {
  let recipientUserIds = [];
  let customRecipients = [];
  let metadata = {};

  try {
    if (typeof row.recipient_user_ids === 'string') {
      recipientUserIds = JSON.parse(row.recipient_user_ids);
    } else if (Array.isArray(row.recipient_user_ids)) {
      recipientUserIds = row.recipient_user_ids;
    }
  } catch {
    recipientUserIds = [];
  }

  try {
    if (typeof row.custom_recipients === 'string') {
      customRecipients = JSON.parse(row.custom_recipients);
    } else if (Array.isArray(row.custom_recipients)) {
      customRecipients = row.custom_recipients;
    }
  } catch {
    customRecipients = [];
  }

  try {
    if (typeof row.metadata === 'string') {
      metadata = JSON.parse(row.metadata);
    } else if (typeof row.metadata === 'object' && row.metadata !== null) {
      metadata = row.metadata;
    }
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    title: row.title,
    subject: row.subject,
    body: row.body,
    segmentType: row.segment_type,
    status: row.status,
    scheduledFor: row.scheduled_for,
    dispatchRequestId: row.dispatch_request_id,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
    recipientUserIds,
    customRecipients,
    metadata,
    createdByUserRefId: row.created_by_user_ref_id,
    createdByUserId: row.created_by_external_user_id,
    updatedByUserRefId: row.updated_by_user_ref_id,
    updatedByUserId: row.updated_by_external_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
  };
}

function parseCreateInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const campaignBody = typeof body?.body === 'string' ? body.body.trim() : '';
  const segmentType = typeof body?.segmentType === 'string' ? body.segmentType.trim() : '';
  const committeeId = typeof body?.committeeId === 'string' ? body.committeeId.trim() : '';
  const status = typeof body?.status === 'string' ? body.status.trim() : 'draft';
  const scheduledFor = parseDateTime('scheduledFor', body?.scheduledFor);
  const recipientUserIds = Array.isArray(body?.recipientUserIds) ? body.recipientUserIds : [];
  const customRecipients = Array.isArray(body?.customRecipients) ? body.customRecipients : [];
  const metadata = typeof body?.metadata === 'object' && body?.metadata !== null ? body.metadata : {};

  if (!title) {
    throw new HttpError(400, 'title is required');
  }
  if (!subject) {
    throw new HttpError(400, 'subject is required');
  }
  if (!campaignBody) {
    throw new HttpError(400, 'body is required');
  }
  if (!ALLOWED_SEGMENTS.has(segmentType)) {
    throw new HttpError(400, `segmentType must be one of: ${Array.from(ALLOWED_SEGMENTS).join(', ')}`);
  }
  if (!ALLOWED_CREATE_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of draft, scheduled');
  }

  if (segmentType === 'all_members') {
    if (committeeId) {
      throw new HttpError(400, 'committeeId must be omitted for all_members segment');
    }
  } else if (segmentType === 'committee_members') {
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'committeeId is required and must be a valid UUID for committee_members segment');
    }
  } else if (segmentType === 'committee_leads') {
    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'committeeId must be a valid UUID when targeting a specific committee');
    }
  } else if (segmentType === 'specific_members') {
    if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      throw new HttpError(400, 'recipientUserIds is required and must contain at least one user ID');
    }
  } else if (segmentType === 'custom_sheet') {
    if (!Array.isArray(customRecipients) || customRecipients.length === 0) {
      throw new HttpError(400, 'customRecipients is required and must contain at least one recipient');
    }
  }

  return {
    title,
    subject,
    body: campaignBody,
    segmentType,
    committeeId: committeeId || null,
    status,
    scheduledFor,
    recipientUserIds,
    customRecipients,
    metadata,
  };
}

function isGlobalPublisher(identity) {
  return identity.role === 'publisher' && identity.scopeType === 'global';
}

async function canSendCampaign(identity, committeeId) {
  if (authzService.isPrivilegedGlobalAccess(identity)) return true;
  if (identity.role === 'publisher') {
    if (identity.scopeType === 'global') return true;
    if (identity.scopeType === 'committee') {
      return !committeeId || identity.scopeId === committeeId;
    }
  }
  if (committeeId) {
    const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
    return membershipRole === 'lead';
  }
  return false;
}

async function ensurePrManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = authzService.canManagePrCommittee({
    identity,
    membershipRole,
    committeeId,
  });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden');
  }
}

async function createCampaign(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});

    if (payload.segmentType === 'all_members' || (payload.segmentType === 'committee_leads' && !payload.committeeId)) {
      if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
        throw new HttpError(403, 'Forbidden');
      }
    } else if (payload.committeeId) {
      const committee = await committeesRepository.getCommitteeById(payload.committeeId);
      if (!committee) {
        throw new HttpError(404, 'Committee not found');
      }
      await ensurePrManageAccess(req.identity, payload.committeeId);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const campaign = await prCampaignsRepository.createCampaign({
      committeeId: payload.committeeId,
      title: payload.title,
      subject: payload.subject,
      body: payload.body,
      segmentType: payload.segmentType,
      status: payload.status,
      scheduledFor: payload.scheduledFor,
      recipientUserIds: payload.recipientUserIds,
      customRecipients: payload.customRecipients,
      metadata: payload.metadata,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'pr.campaign.created',
      requestId: req.requestId,
      campaignId: campaign.id,
      committeeId: campaign.committee_id,
      actorUserId: req.identity.externalUserId,
      segmentType: campaign.segment_type,
      status: campaign.status,
    });

    return res.status(201).json({
      campaign: toCampaignResponse(campaign),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existing = await prCampaignsRepository.getCampaignById(campaignId);
    if (!existing) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (existing.status === 'sent') {
      throw new HttpError(400, 'Cannot edit an already sent campaign');
    }

    if (existing.committee_id) {
      await ensurePrManageAccess(req.identity, existing.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    const subject = typeof body.subject === 'string' ? body.subject.trim() : undefined;
    const campaignBody = typeof body.body === 'string' ? body.body.trim() : undefined;
    const segmentType = typeof body.segmentType === 'string' ? body.segmentType.trim() : undefined;
    const committeeId = typeof body.committeeId === 'string' ? body.committeeId.trim() : undefined;
    const status = typeof body.status === 'string' ? body.status.trim() : undefined;
    const scheduledFor = body.scheduledFor !== undefined ? parseDateTime('scheduledFor', body.scheduledFor) : undefined;
    const recipientUserIds = Array.isArray(body.recipientUserIds) ? body.recipientUserIds : undefined;
    const customRecipients = Array.isArray(body.customRecipients) ? body.customRecipients : undefined;
    const metadata = typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : undefined;

    const updated = await prCampaignsRepository.updateCampaign({
      campaignId,
      title,
      subject,
      body: campaignBody,
      segmentType,
      committeeId: committeeId || null,
      status,
      scheduledFor,
      recipientUserIds,
      customRecipients,
      metadata,
      actorUserId: req.identity.userRefId,
    });

    return res.status(200).json({
      campaign: toCampaignResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existing = await prCampaignsRepository.getCampaignById(campaignId);
    if (!existing) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (existing.committee_id) {
      await ensurePrManageAccess(req.identity, existing.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    await prCampaignsRepository.deleteCampaign(campaignId);
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function archiveCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existing = await prCampaignsRepository.getCampaignById(campaignId);
    if (!existing) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (existing.committee_id) {
      await ensurePrManageAccess(req.identity, existing.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const actorUserId = req.identity.userRefId || req.identity.userId;
    const archived = await prCampaignsRepository.archiveCampaign(campaignId, actorUserId);

    logger.info({
      event: 'pr.campaign.archived',
      requestId: req.requestId,
      campaignId,
      actorUserId,
    });

    return res.status(200).json({
      campaign: toCampaignResponse(archived),
    });
  } catch (error) {
    return next(error);
  }
}

async function unarchiveCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existing = await prCampaignsRepository.getCampaignById(campaignId);
    if (!existing) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (existing.committee_id) {
      await ensurePrManageAccess(req.identity, existing.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const actorUserId = req.identity.userRefId || req.identity.userId;
    const unarchived = await prCampaignsRepository.unarchiveCampaign(campaignId, actorUserId);

    logger.info({
      event: 'pr.campaign.unarchived',
      requestId: req.requestId,
      campaignId,
      actorUserId,
    });

    return res.status(200).json({
      campaign: toCampaignResponse(unarchived),
    });
  } catch (error) {
    return next(error);
  }
}

async function duplicateCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existing = await prCampaignsRepository.getCampaignById(campaignId);
    if (!existing) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (existing.committee_id) {
      await ensurePrManageAccess(req.identity, existing.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const actorUserId = req.identity.userRefId || req.identity.userId;
    const duplicate = await prCampaignsRepository.duplicateCampaign(campaignId, actorUserId);

    logger.info({
      event: 'pr.campaign.duplicated',
      requestId: req.requestId,
      sourceCampaignId: campaignId,
      newCampaignId: duplicate.id,
      actorUserId,
    });

    return res.status(201).json({
      campaign: toCampaignResponse(duplicate),
    });
  } catch (error) {
    return next(error);
  }
}

async function listCampaigns(req, res, next) {
  try {
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const status = typeof req.query?.status === 'string' ? req.query.status.trim() : null;
    const includeArchived = req.query?.includeArchived === 'true' || req.query?.includeArchived === true;
    const limit = parseLimit(req.query?.limit, 50, 100);

    if (committeeId && !isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    let committeeIds = null;
    if (committeeId) {
      await ensurePrManageAccess(req.identity, committeeId);
    } else {
      committeeIds = await authzService.listManageablePrCommitteeIds(req.identity);
      if (Array.isArray(committeeIds) && committeeIds.length === 0) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const campaigns = await prCampaignsRepository.listCampaigns({
      committeeId: committeeId || null,
      committeeIds: committeeId ? null : committeeIds,
      status: status || null,
      includeArchived: status === 'archived' || includeArchived,
      limit,
    });

    return res.status(200).json({
      campaigns: campaigns.map((campaign) => toCampaignResponse(campaign)),
    });
  } catch (error) {
    return next(error);
  }
}

async function previewRecipients(req, res, next) {
  try {
    const segmentType = typeof req.body?.segmentType === 'string' ? req.body.segmentType.trim() : 'all_members';
    const committeeId = typeof req.body?.committeeId === 'string' ? req.body.committeeId.trim() : null;
    const recipientUserIds = Array.isArray(req.body?.recipientUserIds) ? req.body.recipientUserIds : [];
    const customRecipients = Array.isArray(req.body?.customRecipients) ? req.body.customRecipients : [];

    const recipients = await prCampaignsRepository.listRecipientsForSegment({
      segmentType,
      committeeId: committeeId && isUuid(committeeId) ? committeeId : null,
      recipientUserIds,
      customRecipients,
    });

    const seen = new Set();
    const uniqueRecipients = [];
    for (const r of recipients) {
      if (!r.email) continue;
      const clean = r.email.toLowerCase();
      if (seen.has(clean)) continue;
      seen.add(clean);
      uniqueRecipients.push(r);
    }

    const availableVariables = ['user.name', 'user.email', 'user.committee', 'user.role'];
    if (segmentType === 'custom_sheet' && uniqueRecipients.length > 0 && uniqueRecipients[0].customFields) {
      for (const k of Object.keys(uniqueRecipients[0].customFields)) {
        if (!availableVariables.includes(`sheet.${k}`)) {
          availableVariables.push(`sheet.${k}`);
        }
      }
    }

    const formattedRecipients = uniqueRecipients.map((r) => ({
      userId: r.userId || null,
      email: r.email,
      name: r.name,
      committeeName: r.committeeName,
      role: r.role,
      customFields: r.customFields || {},
    }));

    return res.status(200).json({
      totalCount: uniqueRecipients.length,
      recipientCount: uniqueRecipients.length,
      recipients: formattedRecipients,
      sampleRecipients: formattedRecipients.slice(0, 10),
      availableVariables,
    });
  } catch (error) {
    return next(error);
  }
}

async function sendCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const campaign = await prCampaignsRepository.getCampaignById(campaignId);
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    const hasSendAccess = await canSendCampaign(req.identity, campaign.committee_id);
    if (!hasSendAccess) {
      throw new HttpError(403, 'Forbidden');
    }

    if (campaign.status === 'sent') {
      return res.status(200).json({
        campaign: toCampaignResponse(campaign),
        dispatch: {
          idempotent: true,
          requestId: campaign.dispatch_request_id,
          recipientCount: campaign.recipient_count,
          sentCount: campaign.sent_count,
          failedCount: campaign.failed_count,
        },
      });
    }

    // Atomic CAS Lock: transitions status to sending
    const dispatchRequestId = campaign.dispatch_request_id || require('crypto').randomUUID();
    const lockedCampaign = await prCampaignsRepository.claimCampaignForSending(
      campaignId,
      dispatchRequestId,
      req.identity.userRefId
    );

    if (!lockedCampaign) {
      // Another concurrent worker or send request already locked or sent this campaign
      const current = await prCampaignsRepository.getCampaignById(campaignId);
      return res.status(200).json({
        campaign: toCampaignResponse(current),
        dispatch: {
          idempotent: true,
          requestId: current?.dispatch_request_id,
          recipientCount: current?.recipient_count,
          sentCount: current?.sent_count,
          failedCount: current?.failed_count,
        },
      });
    }

    const dispatch = await prCampaignDispatchService.dispatchCampaign({
      requestId: req.requestId,
      route: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
      campaign: lockedCampaign,
      maxRecipients: config.pr?.campaignMaxRecipients || 5000,
    });

    if (!dispatch.ok && dispatch.reason === 'max_recipients_exceeded') {
      await prCampaignsRepository.updateCampaign({
        campaignId,
        status: campaign.status || 'draft',
      });
      throw new HttpError(400, `Campaign exceeds max recipients limit (${config.pr?.campaignMaxRecipients || 5000})`);
    }

    if (!dispatch.ok) {
      const failedCampaign = await prCampaignsRepository.markCampaignFailed({
        campaignId,
        dispatchRequestId: dispatch.dispatchRequestId,
        recipientCount: dispatch.recipientCount,
        sentCount: dispatch.sentCount,
        failedCount: dispatch.failedCount,
        error: dispatch.reason,
        actorUserRefId: req.identity.userRefId,
      });

      await prCampaignsRepository.createDispatchLog({
        campaignId,
        dispatchRequestId: dispatch.dispatchRequestId,
        status: 'failed',
        recipientCount: dispatch.recipientCount,
        sentCount: dispatch.sentCount,
        failedCount: dispatch.failedCount,
        error: dispatch.reason,
        logs: dispatch.logs || [],
      });

      logger.warn({
        event: 'pr.campaign.dispatch_failed',
        requestId: req.requestId,
        campaignId,
        committeeId: campaign.committee_id,
        actorUserId: req.identity.externalUserId,
        reason: dispatch.reason,
      }, 'PR campaign dispatch failed');

      const status = dispatch.statusCode || 502;
      const message = status === 503 ? 'Campaign dispatch unavailable' : 'Campaign dispatch failed';
      return res.status(status).json({
        error: message,
        campaign: failedCampaign ? toCampaignResponse(failedCampaign) : toCampaignResponse(campaign),
      });
    }

    const sentCampaign = await prCampaignsRepository.markCampaignSent({
      campaignId,
      dispatchRequestId: dispatch.dispatchRequestId,
      recipientCount: dispatch.recipientCount,
      sentCount: dispatch.sentCount,
      failedCount: dispatch.failedCount,
      actorUserRefId: req.identity.userRefId,
    });

    await prCampaignsRepository.createDispatchLog({
      campaignId,
      dispatchRequestId: dispatch.dispatchRequestId,
      status: 'sent',
      recipientCount: dispatch.recipientCount,
      sentCount: dispatch.sentCount,
      failedCount: dispatch.failedCount,
      error: null,
      logs: dispatch.logs || [],
    });

    logger.info({
      event: 'pr.campaign.sent',
      requestId: req.requestId,
      campaignId,
      committeeId: campaign.committee_id,
      actorUserId: req.identity.externalUserId,
      recipientCount: dispatch.recipientCount,
      sentCount: dispatch.sentCount,
      failedCount: dispatch.failedCount,
    });

    return res.status(200).json({
      campaign: toCampaignResponse(sentCampaign),
      dispatch: {
        idempotent: false,
        requestId: dispatch.dispatchRequestId,
        recipientCount: dispatch.recipientCount,
        sentCount: dispatch.sentCount,
        failedCount: dispatch.failedCount,
        skippedCount: dispatch.skippedCount,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getCampaignDelivery(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const campaign = await prCampaignsRepository.getCampaignById(campaignId);
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (campaign.committee_id) {
      await ensurePrManageAccess(req.identity, campaign.committee_id);
    } else if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
      throw new HttpError(403, 'Forbidden');
    }

    const attempts = await prCampaignsRepository.listDispatchLogsByCampaign(campaignId);

    // Resolve expected recipients for pre-dispatch audit or full recipient overview
    let expectedRecipients = [];
    try {
      let recipientUserIds = [];
      let customRecipients = [];
      if (typeof campaign.recipient_user_ids === 'string') {
        recipientUserIds = JSON.parse(campaign.recipient_user_ids);
      } else if (Array.isArray(campaign.recipient_user_ids)) {
        recipientUserIds = campaign.recipient_user_ids;
      }
      if (typeof campaign.custom_recipients === 'string') {
        customRecipients = JSON.parse(campaign.custom_recipients);
      } else if (Array.isArray(campaign.custom_recipients)) {
        customRecipients = campaign.custom_recipients;
      }

      const rawRecipients = await prCampaignsRepository.listRecipientsForSegment({
        segmentType: campaign.segment_type,
        committeeId: campaign.committee_id,
        recipientUserIds,
        customRecipients,
      });

      const seen = new Set();
      for (const r of rawRecipients) {
        if (!r.email) continue;
        const clean = r.email.toLowerCase();
        if (seen.has(clean)) continue;
        seen.add(clean);
        expectedRecipients.push({
          email: r.email,
          name: r.name,
          committeeName: r.committeeName,
          role: r.role,
          customFields: r.customFields || {},
          status: campaign.status === 'sent' ? 'sent' : campaign.status === 'scheduled' ? 'scheduled' : 'ready',
        });
      }
    } catch {
      expectedRecipients = [];
    }

    return res.status(200).json({
      campaign: toCampaignResponse(campaign),
      delivery: {
        dispatchRequestId: campaign.dispatch_request_id,
        recipientCount: campaign.recipient_count || expectedRecipients.length,
        expectedRecipientCount: expectedRecipients.length,
        expectedRecipients,
        sentCount: campaign.sent_count,
        failedCount: campaign.failed_count,
        attempts: attempts.map((attempt) => {
          let parsedLogs = [];
          try {
            if (typeof attempt.logs === 'string') {
              parsedLogs = JSON.parse(attempt.logs);
            } else if (Array.isArray(attempt.logs)) {
              parsedLogs = attempt.logs;
            }
          } catch {
            parsedLogs = [];
          }
          return {
            id: attempt.id,
            campaignId: attempt.campaign_id,
            dispatchRequestId: attempt.dispatch_request_id,
            status: attempt.status,
            recipientCount: attempt.recipient_count,
            sentCount: attempt.sent_count,
            failedCount: attempt.failed_count,
            errorMessage: attempt.error,
            logs: parsedLogs,
            createdAt: attempt.created_at,
          };
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCampaign,
  updateCampaign,
  deleteCampaign,
  archiveCampaign,
  unarchiveCampaign,
  duplicateCampaign,
  getCampaignDelivery,
  listCampaigns,
  previewRecipients,
  sendCampaign,
};
