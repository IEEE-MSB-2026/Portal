const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const hrCampaignsRepository = require('../repositories/hrCampaignsRepository');
const hrApplicationsRepository = require('../repositories/hrApplicationsRepository');
const hrStageLogRepository = require('../repositories/hrStageLogRepository');

const ALLOWED_STAGES = new Set(['applied', 'screening', 'interview', 'final_review', 'rejected']);
const STAGE_TRANSITIONS = {
  applied: new Set(['screening']),
  screening: new Set(['interview']),
  interview: new Set(['final_review']),
  final_review: new Set([]),
  rejected: new Set([]),
};

function isNowWithinCampaignWindow(campaign, now = new Date()) {
  const opensAt = new Date(campaign.opens_at).getTime();
  const closesAt = new Date(campaign.closes_at).getTime();
  const nowMs = now.getTime();
  return nowMs >= opensAt && nowMs <= closesAt;
}

function isCampaignOpen(campaign, now = new Date()) {
  return campaign.status === 'open' && isNowWithinCampaignWindow(campaign, now);
}

function toApplicationResponse(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    committeeId: row.committee_id,
    applicantUserRefId: row.applicant_user_ref_id,
    applicantUserId: row.applicant_external_user_id,
    applicantEmail: row.applicant_email,
    answers: row.answers,
    currentStage: row.current_stage,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    campaignTitle: row.campaign_title,
  };
}

function parseCreateInput(body) {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
  const answers = body.answers === undefined ? {} : body.answers;

  if (!isUuid(campaignId)) {
    throw new HttpError(400, 'campaignId is required and must be a valid UUID');
  }
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new HttpError(400, 'answers must be an object');
  }

  return { campaignId, answers };
}

function parseStageInput(body) {
  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const score = body.score;

  if (!ALLOWED_STAGES.has(stage)) {
    throw new HttpError(400, 'stage must be one of applied, screening, interview, final_review, rejected');
  }

  if (stage === 'rejected') {
    throw new HttpError(400, 'Use reject endpoint for rejected stage');
  }

  if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 100)) {
    throw new HttpError(400, 'score must be an integer between 0 and 100');
  }

  return {
    stage,
    notes: notes || null,
    score: score === undefined ? null : score,
  };
}

function parseRejectInput(body) {
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  return { notes: notes || null };
}

function isDuplicateApplicationError(error) {
  if (error?.code === '23505') return true;
  return typeof error?.message === 'string' && error.message.toLowerCase().includes('unique');
}

async function ensureHrManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = authzService.canManageHrCommittee({ identity, membershipRole });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden');
  }
}

async function createApplication(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});
    const campaign = await hrCampaignsRepository.getCampaignById(payload.campaignId);
    if (!campaign) {
      throw new HttpError(404, 'Campaign not found');
    }

    if (!authzService.canSubmitHrApplication(req.identity)) {
      throw new HttpError(403, 'Forbidden');
    }

    if (!isCampaignOpen(campaign)) {
      throw new HttpError(400, 'Campaign is not open for applications');
    }

    let application;
    try {
      application = await hrApplicationsRepository.createApplication({
        campaignId: campaign.id,
        applicantUserRefId: req.identity.userRefId,
        answers: payload.answers,
      });
    } catch (error) {
      if (isDuplicateApplicationError(error)) {
        throw new HttpError(409, 'Application already submitted for this campaign');
      }
      throw error;
    }

    await hrStageLogRepository.createStageLog({
      applicationId: application.id,
      fromStage: null,
      toStage: application.current_stage,
      score: null,
      notes: null,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'hr.application.submitted',
      requestId: req.requestId,
      applicationId: application.id,
      campaignId: campaign.id,
      committeeId: campaign.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      application: {
        id: application.id,
        campaignId: application.campaign_id,
        applicantUserRefId: application.applicant_user_ref_id,
        answers: application.answers,
        currentStage: application.current_stage,
        submittedAt: application.submitted_at,
        createdAt: application.created_at,
        updatedAt: application.updated_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listApplications(req, res, next) {
  try {
    const campaignIdRaw = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    const committeeIdRaw = typeof req.query.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const limit = parseLimit(req.query.limit, 50, 100);

    let campaign = null;
    let committeeId = null;

    if (campaignIdRaw) {
      if (!isUuid(campaignIdRaw)) {
        throw new HttpError(400, 'Invalid campaignId format');
      }
      campaign = await hrCampaignsRepository.getCampaignById(campaignIdRaw);
      if (!campaign) {
        throw new HttpError(404, 'Campaign not found');
      }
      committeeId = campaign.committee_id;
    }

    if (committeeIdRaw) {
      if (!isUuid(committeeIdRaw)) {
        throw new HttpError(400, 'Invalid committeeId format');
      }
      if (committeeId && committeeId !== committeeIdRaw) {
        throw new HttpError(400, 'campaignId and committeeId mismatch');
      }
      committeeId = committeeIdRaw;
    }

    if (committeeId) {
      await ensureHrManageAccess(req.identity, committeeId);
    } else if (!authzService.isPrivilegedGlobalAccess(req.identity)) {
      throw new HttpError(403, 'Forbidden');
    }

    const applications = await hrApplicationsRepository.listApplications({
      committeeId,
      campaignId: campaign ? campaign.id : null,
      limit,
    });

    return res.status(200).json({
      applications: applications.map((row) => toApplicationResponse(row)),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateApplicationStage(req, res, next) {
  try {
    const applicationId = req.params.applicationId;
    if (!isUuid(applicationId)) {
      throw new HttpError(400, 'Invalid applicationId format');
    }

    const payload = parseStageInput(req.body || {});
    const application = await hrApplicationsRepository.getApplicationById(applicationId);
    if (!application) {
      throw new HttpError(404, 'Application not found');
    }

    await ensureHrManageAccess(req.identity, application.committee_id);

    const allowedTransitions = STAGE_TRANSITIONS[application.current_stage] || new Set();
    if (!allowedTransitions.has(payload.stage)) {
      throw new HttpError(400, 'Invalid application stage transition');
    }

    const updated = await hrApplicationsRepository.updateApplicationStage(application.id, payload.stage);
    await hrStageLogRepository.createStageLog({
      applicationId: application.id,
      fromStage: application.current_stage,
      toStage: payload.stage,
      score: payload.score,
      notes: payload.notes,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'hr.application.stage_changed',
      requestId: req.requestId,
      applicationId: application.id,
      campaignId: application.campaign_id,
      committeeId: application.committee_id,
      actorUserId: req.identity.externalUserId,
      fromStage: application.current_stage,
      toStage: payload.stage,
    });

    return res.status(200).json({
      application: {
        id: updated.id,
        campaignId: updated.campaign_id,
        applicantUserRefId: updated.applicant_user_ref_id,
        answers: updated.answers,
        currentStage: updated.current_stage,
        submittedAt: updated.submitted_at,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function rejectApplication(req, res, next) {
  try {
    const applicationId = req.params.applicationId;
    if (!isUuid(applicationId)) {
      throw new HttpError(400, 'Invalid applicationId format');
    }

    const payload = parseRejectInput(req.body || {});
    const application = await hrApplicationsRepository.getApplicationById(applicationId);
    if (!application) {
      throw new HttpError(404, 'Application not found');
    }

    await ensureHrManageAccess(req.identity, application.committee_id);

    if (application.current_stage === 'rejected') {
      throw new HttpError(400, 'Application is already rejected');
    }

    const updated = await hrApplicationsRepository.updateApplicationStage(application.id, 'rejected');
    await hrStageLogRepository.createStageLog({
      applicationId: application.id,
      fromStage: application.current_stage,
      toStage: 'rejected',
      score: null,
      notes: payload.notes,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'hr.application.rejected',
      requestId: req.requestId,
      applicationId: application.id,
      campaignId: application.campaign_id,
      committeeId: application.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      application: {
        id: updated.id,
        campaignId: updated.campaign_id,
        applicantUserRefId: updated.applicant_user_ref_id,
        answers: updated.answers,
        currentStage: updated.current_stage,
        submittedAt: updated.submitted_at,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createApplication,
  listApplications,
  rejectApplication,
  updateApplicationStage,
};
