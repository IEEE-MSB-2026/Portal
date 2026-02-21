const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const hrCampaignsRepository = require('../repositories/hrCampaignsRepository');
const authzService = require('../services/authzService');

const ALLOWED_CAMPAIGN_STATUSES = new Set(['draft', 'open', 'closed']);

function parseDateTime(fieldName, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO date-time`);
  }
  return parsed.toISOString();
}

function parseCampaignInput(body) {
  const committeeId = typeof body.committeeId === 'string' ? body.committeeId.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const opensAt = parseDateTime('opensAt', body.opensAt);
  const closesAt = parseDateTime('closesAt', body.closesAt);
  const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';
  const status = statusRaw || 'draft';
  const formSchema = body.formSchema === undefined ? {} : body.formSchema;

  if (!isUuid(committeeId)) {
    throw new HttpError(400, 'committeeId is required and must be a valid UUID');
  }
  if (!title) {
    throw new HttpError(400, 'title is required');
  }
  if (!ALLOWED_CAMPAIGN_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of draft, open, closed');
  }
  if (new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw new HttpError(400, 'closesAt must be greater than opensAt');
  }
  if (formSchema === null || typeof formSchema !== 'object' || Array.isArray(formSchema)) {
    throw new HttpError(400, 'formSchema must be an object');
  }

  return {
    committeeId,
    title,
    description: description || null,
    opensAt,
    closesAt,
    status,
    formSchema,
  };
}

function parseStatusInput(body) {
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!ALLOWED_CAMPAIGN_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of draft, open, closed');
  }
  return status;
}

function isNowWithinCampaignWindow(campaign, now = new Date()) {
  const opensAt = new Date(campaign.opens_at).getTime();
  const closesAt = new Date(campaign.closes_at).getTime();
  const nowMs = now.getTime();
  return nowMs >= opensAt && nowMs <= closesAt;
}

function toCampaignResponse(campaign) {
  return {
    id: campaign.id,
    committeeId: campaign.committee_id,
    title: campaign.title,
    description: campaign.description,
    opensAt: campaign.opens_at,
    closesAt: campaign.closes_at,
    status: campaign.status,
    formSchema: campaign.form_schema,
    createdByUserRefId: campaign.created_by_user_ref_id,
    createdAt: campaign.created_at,
    updatedAt: campaign.updated_at,
  };
}

async function createCampaign(req, res, next) {
  try {
    const payload = parseCampaignInput(req.body || {});
    const committee = await committeesRepository.getCommitteeById(payload.committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, payload.committeeId);
    const canManage = authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    if (payload.status === 'open' && !isNowWithinCampaignWindow({
      opens_at: payload.opensAt,
      closes_at: payload.closesAt,
    })) {
      throw new HttpError(400, 'Cannot open campaign outside its configured time window');
    }

    const campaign = await hrCampaignsRepository.createCampaign({
      committeeId: payload.committeeId,
      title: payload.title,
      description: payload.description,
      opensAt: payload.opensAt,
      closesAt: payload.closesAt,
      status: payload.status,
      formSchema: payload.formSchema,
      createdByUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'hr.campaign.created',
      requestId: req.requestId,
      campaignId: campaign.id,
      committeeId: campaign.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({ campaign: toCampaignResponse(campaign) });
  } catch (error) {
    return next(error);
  }
}

async function updateCampaignStatus(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const status = parseStatusInput(req.body || {});
    const existingCampaign = await hrCampaignsRepository.getCampaignById(campaignId);
    if (!existingCampaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, existingCampaign.committee_id);
    const canManage = authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    if (existingCampaign.status === status) {
      throw new HttpError(400, 'Campaign status is already set to this value');
    }

    if (status === 'open' && !isNowWithinCampaignWindow(existingCampaign)) {
      throw new HttpError(400, 'Cannot open campaign outside its configured time window');
    }

    const campaign = await hrCampaignsRepository.updateCampaignStatus(campaignId, status);
    logger.info({
      event: 'hr.campaign.status_changed',
      requestId: req.requestId,
      campaignId,
      committeeId: campaign.committee_id,
      actorUserId: req.identity.externalUserId,
      status,
    });

    return res.status(200).json({ campaign: toCampaignResponse(campaign) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCampaign,
  updateCampaignStatus,
};
