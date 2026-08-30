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
  let committeeIds = Array.isArray(body.committeeIds)
    ? body.committeeIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const singleCommitteeId = typeof body.committeeId === 'string' ? body.committeeId.trim() : '';
  if (!committeeIds.length && singleCommitteeId) {
    committeeIds = [singleCommitteeId];
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const opensAt = parseDateTime('opensAt', body.opensAt);
  const closesAt = parseDateTime('closesAt', body.closesAt);
  const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';
  const status = statusRaw || 'draft';
  const formSchema = body.formSchema === undefined ? {} : body.formSchema;

  if (!committeeIds.length) {
    throw new HttpError(400, 'At least one committeeId is required');
  }
  for (const cId of committeeIds) {
    if (!isUuid(cId)) {
      throw new HttpError(400, `Invalid committeeId: ${cId}`);
    }
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
    committeeId: committeeIds[0],
    committeeIds,
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
    committees: campaign.committees || [],
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

    for (const cId of payload.committeeIds) {
      const committee = await committeesRepository.getCommitteeById(cId);
      if (!committee) {
        throw new HttpError(404, `Committee not found: ${cId}`);
      }
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, payload.committeeId);
    const canManage = await authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
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
      committeeIds: payload.committeeIds,
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

async function updateCampaign(req, res, next) {
  try {
    const campaignId = req.params.campaignId;
    if (!isUuid(campaignId)) {
      throw new HttpError(400, 'Invalid campaignId format');
    }

    const existingCampaign = await hrCampaignsRepository.getCampaignById(campaignId);
    if (!existingCampaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, existingCampaign.committee_id);
    const canManage = await authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }

    const body = req.body || {};
    const updates = {};

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new HttpError(400, 'title cannot be empty');
      updates.title = title;
    }
    if (body.description !== undefined) {
      updates.description = body.description ? String(body.description).trim() : null;
    }
    if (body.opensAt !== undefined) {
      updates.opensAt = parseDateTime('opensAt', body.opensAt);
    }
    if (body.closesAt !== undefined) {
      updates.closesAt = parseDateTime('closesAt', body.closesAt);
    }
    if (body.status !== undefined) {
      updates.status = parseStatusInput(body);
    }

    const effectiveOpensAt = updates.opensAt || existingCampaign.opens_at;
    const effectiveClosesAt = updates.closesAt || existingCampaign.closes_at;
    if (new Date(effectiveClosesAt).getTime() <= new Date(effectiveOpensAt).getTime()) {
      throw new HttpError(400, 'closesAt must be greater than opensAt');
    }

    if (Array.isArray(body.committeeIds)) {
      const cIds = body.committeeIds.map((id) => String(id).trim()).filter(Boolean);
      if (!cIds.length) throw new HttpError(400, 'At least one committeeId is required');
      for (const cId of cIds) {
        if (!isUuid(cId)) throw new HttpError(400, `Invalid committeeId: ${cId}`);
        const committee = await committeesRepository.getCommitteeById(cId);
        if (!committee) throw new HttpError(404, `Committee not found: ${cId}`);
      }
      updates.committeeIds = cIds;
    }

    const effectiveStatus = updates.status || existingCampaign.status;
    if (effectiveStatus === 'open' && !isNowWithinCampaignWindow({
      opens_at: effectiveOpensAt,
      closes_at: effectiveClosesAt,
    })) {
      throw new HttpError(400, 'Cannot open campaign outside its configured time window');
    }

    const campaign = await hrCampaignsRepository.updateCampaign(campaignId, updates);
    return res.status(200).json({ campaign: toCampaignResponse(campaign) });
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
    const canManage = await authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
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

async function listCampaigns(req, res, next) {
  try {
    const committeeIdRaw = typeof req.query.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    let committeeId = null;
    if (committeeIdRaw) {
      if (!isUuid(committeeIdRaw)) {
        throw new HttpError(400, 'Invalid committeeId format');
      }
      committeeId = committeeIdRaw;
    }

    if (committeeId) {
      const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
      const canManage = await authzService.canManageHrCommittee({ identity: req.identity, membershipRole });
      if (!canManage) {
        throw new HttpError(403, 'Forbidden');
      }
    } else {
      const hasBranchAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
      if (!hasBranchAccess) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const campaigns = await hrCampaignsRepository.listCampaigns({ committeeId, status: statusFilter || null });
    return res.status(200).json({
      campaigns: campaigns.map((c) => toCampaignResponse(c)),
    });
  } catch (error) {
    return next(error);
  }
}

async function getOpenCampaigns(req, res, next) {
  try {
    const campaigns = await hrCampaignsRepository.listCampaigns({ committeeId: null, status: 'open' });
    const now = new Date();
    const openCampaigns = campaigns.filter((c) => isNowWithinCampaignWindow(c, now));
    return res.status(200).json({
      campaigns: openCampaigns.map((c) => toCampaignResponse(c)),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCampaign,
  updateCampaign,
  getOpenCampaigns,
  listCampaigns,
  updateCampaignStatus,
};
