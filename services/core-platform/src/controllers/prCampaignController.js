const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const prCampaignDispatchService = require('../services/prCampaignDispatchService');
const committeesRepository = require('../repositories/committeesRepository');
const prCampaignsRepository = require('../repositories/prCampaignsRepository');

const ALLOWED_SEGMENTS = new Set(['all_members', 'committee_members', 'committee_leads']);
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
    throw new HttpError(400, 'segmentType must be one of all_members, committee_members, committee_leads');
  }
  if (!ALLOWED_CREATE_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of draft, scheduled');
  }

  if (segmentType === 'all_members') {
    if (committeeId) {
      throw new HttpError(400, 'committeeId must be omitted for all_members segment');
    }
  } else {
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'committeeId is required and must be a valid UUID for committee segment');
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
  };
}

function isGlobalPublisher(identity) {
  return identity.role === 'publisher' && identity.scopeType === 'global';
}

function canSendCampaign(identity, committeeId) {
  if (!['admin', 'publisher'].includes(identity.role)) return false;
  if (identity.scopeType === 'global') return true;
  if (identity.scopeType === 'committee') {
    if (!committeeId) return false;
    return identity.scopeId === committeeId;
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

    if (payload.segmentType === 'all_members') {
      if (!(authzService.isPrivilegedGlobalAccess(req.identity) || isGlobalPublisher(req.identity))) {
        throw new HttpError(403, 'Forbidden');
      }
    } else {
      const committee = await committeesRepository.getCommitteeById(payload.committeeId);
      if (!committee) {
        throw new HttpError(404, 'Committee not found');
      }
      await ensurePrManageAccess(req.identity, payload.committeeId);
    }

    const campaign = await prCampaignsRepository.createCampaign({
      committeeId: payload.committeeId,
      title: payload.title,
      subject: payload.subject,
      body: payload.body,
      segmentType: payload.segmentType,
      status: payload.status,
      scheduledFor: payload.scheduledFor,
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

async function listCampaigns(req, res, next) {
  try {
    const committeeId = typeof req.query?.committeeId === 'string' ? req.query.committeeId.trim() : '';
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
      limit,
    });

    return res.status(200).json({
      campaigns: campaigns.map((campaign) => toCampaignResponse(campaign)),
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

    if (!canSendCampaign(req.identity, campaign.committee_id)) {
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

    const dispatch = await prCampaignDispatchService.dispatchCampaign({
      requestId: req.requestId,
      route: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
      campaign,
      maxRecipients: config.pr.campaignMaxRecipients,
    });

    if (!dispatch.ok && dispatch.reason === 'max_recipients_exceeded') {
      throw new HttpError(400, `Campaign exceeds max recipients limit (${config.pr.campaignMaxRecipients})`);
    }

    if (!dispatch.ok) {
      const failedCampaign = await prCampaignsRepository.markCampaignFailed({
        campaignId,
        dispatchRequestId: dispatch.dispatchRequestId,
        recipientCount: dispatch.recipientCount,
        sentCount: dispatch.sentCount,
        failedCount: dispatch.failedCount,
        errorMessage: dispatch.reason,
        actorUserRefId: req.identity.userRefId,
      });

      await prCampaignsRepository.createDispatchLog({
        campaignId,
        dispatchRequestId: dispatch.dispatchRequestId,
        actorUserRefId: req.identity.userRefId,
        status: 'failed',
        recipientCount: dispatch.recipientCount,
        sentCount: dispatch.sentCount,
        failedCount: dispatch.failedCount,
        errorMessage: dispatch.reason,
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
      actorUserRefId: req.identity.userRefId,
      status: 'sent',
      recipientCount: dispatch.recipientCount,
      sentCount: dispatch.sentCount,
      failedCount: dispatch.failedCount,
      errorMessage: null,
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

    const attempts = await prCampaignsRepository.listDispatchLogsByCampaign(campaignId, { limit: 20 });
    return res.status(200).json({
      campaign: toCampaignResponse(campaign),
      delivery: {
        dispatchRequestId: campaign.dispatch_request_id,
        recipientCount: campaign.recipient_count,
        sentCount: campaign.sent_count,
        failedCount: campaign.failed_count,
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          campaignId: attempt.campaign_id,
          dispatchRequestId: attempt.dispatch_request_id,
          status: attempt.status,
          recipientCount: attempt.recipient_count,
          sentCount: attempt.sent_count,
          failedCount: attempt.failed_count,
          errorMessage: attempt.error_message,
          actorUserId: attempt.actor_external_user_id,
          createdAt: attempt.created_at,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCampaign,
  getCampaignDelivery,
  listCampaigns,
  sendCampaign,
};
