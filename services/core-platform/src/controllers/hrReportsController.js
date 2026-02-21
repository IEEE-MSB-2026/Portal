const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const hrCampaignsRepository = require('../repositories/hrCampaignsRepository');
const hrReportsRepository = require('../repositories/hrReportsRepository');

const ALLOWED_GRANULARITY = new Set(['day', 'week']);

function parseScope(query) {
  const committeeId = typeof query.committeeId === 'string' ? query.committeeId.trim() : null;
  const campaignId = typeof query.campaignId === 'string' ? query.campaignId.trim() : null;

  if (committeeId && !isUuid(committeeId)) {
    throw new HttpError(400, 'Invalid committeeId format');
  }

  if (campaignId && !isUuid(campaignId)) {
    throw new HttpError(400, 'Invalid campaignId format');
  }

  return {
    committeeId: committeeId || null,
    campaignId: campaignId || null,
  };
}

function parseTimelineWindow(query) {
  const now = new Date();
  const granularity = typeof query.granularity === 'string' ? query.granularity.trim() : 'day';
  if (!ALLOWED_GRANULARITY.has(granularity)) {
    throw new HttpError(400, 'granularity must be one of day, week');
  }

  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

  if (Number.isNaN(from.getTime())) {
    throw new HttpError(400, 'from must be a valid ISO date-time');
  }
  if (Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'to must be a valid ISO date-time');
  }
  if (from.getTime() >= to.getTime()) {
    throw new HttpError(400, 'from must be earlier than to');
  }

  return {
    from,
    to,
    granularity,
  };
}

async function resolveAuthorizedScope({ identity, scope }) {
  let { committeeId, campaignId } = scope;

  if (campaignId) {
    const campaign = await hrCampaignsRepository.getCampaignById(campaignId);
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (committeeId && committeeId !== campaign.committee_id) {
      throw new HttpError(400, 'campaignId and committeeId mismatch');
    }

    committeeId = campaign.committee_id;
  }

  if (committeeId) {
    const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
    const canManage = authzService.canManageHrCommittee({ identity, membershipRole });
    if (!canManage) {
      throw new HttpError(403, 'Forbidden');
    }
  } else if (!authzService.isPrivilegedGlobalAccess(identity)) {
    throw new HttpError(403, 'Forbidden');
  }

  return { committeeId, campaignId };
}

function formatStageCounts(stages) {
  return {
    applied: stages.applied || 0,
    screening: stages.screening || 0,
    interview: stages.interview || 0,
    finalReview: stages.final_review || 0,
    accepted: stages.accepted || 0,
    rejected: stages.rejected || 0,
  };
}

function formatTimelinePoints(points) {
  return points.map((point) => ({
    bucketStart: point.bucketStart,
    totalTransitions: point.totalTransitions,
    toStages: formatStageCounts(point.toStages),
  }));
}

async function getPipelineSummary(req, res, next) {
  try {
    const rawScope = parseScope(req.query || {});
    const scope = await resolveAuthorizedScope({ identity: req.identity, scope: rawScope });

    const summary = await hrReportsRepository.getPipelineSummary(scope);

    return res.status(200).json({
      scope,
      totals: {
        applications: summary.total,
      },
      stages: formatStageCounts(summary.stages),
    });
  } catch (error) {
    return next(error);
  }
}

async function getPipelineTimeline(req, res, next) {
  try {
    const rawScope = parseScope(req.query || {});
    const scope = await resolveAuthorizedScope({ identity: req.identity, scope: rawScope });
    const window = parseTimelineWindow(req.query || {});

    const points = await hrReportsRepository.getPipelineTimeline({
      ...scope,
      from: window.from,
      to: window.to,
      granularity: window.granularity,
    });

    return res.status(200).json({
      scope,
      granularity: window.granularity,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      points: formatTimelinePoints(points),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getPipelineSummary,
  getPipelineTimeline,
};
