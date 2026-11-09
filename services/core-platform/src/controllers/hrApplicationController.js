const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const { parseLimit } = require('../utils/pagination');
const authzService = require('../services/authzService');
const iamRoleAssignmentService = require('../services/iamRoleAssignmentService');
const emailNotificationService = require('../services/emailNotificationService');
const hrCampaignsRepository = require('../repositories/hrCampaignsRepository');
const hrApplicationsRepository = require('../repositories/hrApplicationsRepository');
const hrStageLogRepository = require('../repositories/hrStageLogRepository');

const ALLOWED_STAGES = new Set(['applied', 'screening', 'interview', 'final_review', 'rejected', 'accepted']);
const STAGE_TRANSITIONS = {
  applied: new Set(['screening', 'interview', 'final_review']),
  screening: new Set(['interview', 'final_review', 'applied']),
  interview: new Set(['final_review', 'applied', 'screening']),
  final_review: new Set(['applied', 'screening', 'interview']),
  rejected: new Set([]),
  accepted: new Set([]),
};
const ACCEPTABLE_STAGE = 'final_review';
const ONBOARDING_CHECKLIST_TEMPLATE = [
  {
    templateKey: 'complete_profile',
    title: 'Complete Your Portal Profile',
    sortOrder: 1,
  },
  {
    templateKey: 'join_community',
    title: 'Join Our WhatsApp Community',
    sortOrder: 2,
  },
  {
    templateKey: 'attend_meeting',
    title: 'Attend General Meeting',
    sortOrder: 3,
  },
  {
    templateKey: 'explore_workspace',
    title: 'Explore Committee Workspace',
    sortOrder: 4,
  },
];

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
    welcomeEmailSent: Boolean(row.welcome_email_sent),
    welcomeEmailSentAt: row.welcome_email_sent_at || null,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    campaignTitle: row.campaign_title,
    committeeName: row.committee_name,
  };
}

function parseCreateInput(body) {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
  const committeeId = typeof body.committeeId === 'string' ? body.committeeId.trim() : '';
  const answers = body.answers === undefined ? {} : body.answers;

  if (!isUuid(campaignId)) {
    throw new HttpError(400, 'campaignId is required and must be a valid UUID');
  }
  if (committeeId && !isUuid(committeeId)) {
    throw new HttpError(400, 'committeeId must be a valid UUID');
  }
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new HttpError(400, 'answers must be an object');
  }

  return { campaignId, committeeId: committeeId || null, answers };
}

function parseStageInput(body) {
  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const score = body.score;

  if (!ALLOWED_STAGES.has(stage)) {
    throw new HttpError(400, 'stage must be one of applied, screening, interview, final_review, rejected, accepted');
  }

  if (stage === 'rejected') {
    throw new HttpError(400, 'Use reject endpoint for rejected stage');
  }

  if (stage === 'accepted') {
    throw new HttpError(400, 'Use accept endpoint for accepted stage');
  }

  if (score !== undefined && score !== null && (!Number.isInteger(Number(score)) || Number(score) < 0 || Number(score) > 100)) {
    throw new HttpError(400, 'score must be an integer between 0 and 100');
  }

  return {
    stage,
    notes: notes || null,
    score: score === undefined || score === null ? null : Number(score),
  };
}

function parseRejectInput(body) {
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  return { notes: notes || null };
}

function parseAcceptInput(body) {
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  return { notes: notes || null };
}

function isDuplicateApplicationError(error) {
  if (error?.code === '23505') return true;
  return typeof error?.message === 'string' && error.message.toLowerCase().includes('unique');
}

async function ensureHrManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = await authzService.canManageHrCommittee({ identity, membershipRole });
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

    let targetCommitteeId = payload.committeeId || campaign.committee_id;
    if (payload.committeeId && campaign.committees?.length > 0) {
      const validCommittee = campaign.committees.some((c) => c.id === payload.committeeId);
      if (!validCommittee && campaign.committee_id !== payload.committeeId) {
        throw new HttpError(400, 'Selected committee is not part of this recruitment campaign');
      }
    }

    let application;
    try {
      application = await hrApplicationsRepository.createApplication({
        campaignId: campaign.id,
        committeeId: targetCommitteeId,
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
      committeeId: targetCommitteeId || campaign.committee_id,
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

    let campaign = null;
    let targetCommitteeId = null;

    if (campaignIdRaw) {
      if (!isUuid(campaignIdRaw)) {
        throw new HttpError(400, 'Invalid campaignId format');
      }
      campaign = await hrCampaignsRepository.getCampaignById(campaignIdRaw);
      if (!campaign) {
        throw new HttpError(404, 'Campaign not found');
      }
    }

    if (committeeIdRaw) {
      if (!isUuid(committeeIdRaw)) {
        throw new HttpError(400, 'Invalid committeeId format');
      }
      targetCommitteeId = committeeIdRaw;
    }

    if (targetCommitteeId) {
      await ensureHrManageAccess(req.identity, targetCommitteeId);
    } else if (campaign) {
      const isPrivileged = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
      if (!isPrivileged) {
        const campaignCommittees = campaign.committees || [];
        let hasAccess = campaign.committee_id ? await authzService.isCommitteeLead(req.identity, campaign.committee_id) : false;
        if (!hasAccess) {
          for (const c of campaignCommittees) {
            if (await authzService.isCommitteeLead(req.identity, c.id)) {
              hasAccess = true;
              break;
            }
          }
        }
        if (!hasAccess) {
          throw new HttpError(403, 'Forbidden');
        }
      }
    } else {
      const hasBranchAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
      if (!hasBranchAccess) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const includeAll = req.query.all === 'true' || req.query.includeAll === 'true';
    const includeRejected = includeAll || req.query.includeRejected === 'true' || req.query.rejected === 'true';
    const includeAccepted = includeAll || req.query.includeAccepted === 'true' || req.query.accepted === 'true';
    const stageRaw = typeof req.query.stage === 'string' ? req.query.stage.trim() : '';

    const hasLimitParam = req.query.limit !== undefined && req.query.limit !== 'all';
    const hasPageParam = req.query.page !== undefined;

    let limit = null;
    let page = 1;
    let offset = 0;

    if (hasLimitParam) {
      limit = parseLimit(req.query.limit, 50, 5000);
    }

    if (hasPageParam) {
      const parsedPage = Number.parseInt(req.query.page, 10);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        throw new HttpError(400, 'page must be an integer greater than or equal to 1');
      }
      page = parsedPage;
      if (!hasLimitParam) {
        limit = 50;
      }
      offset = (page - 1) * limit;
    } else if (req.query.offset !== undefined) {
      offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    }

    const { rows, total } = await hrApplicationsRepository.listApplications({
      committeeId: targetCommitteeId,
      campaignId: campaign ? campaign.id : null,
      stage: stageRaw || null,
      includeRejected,
      includeAccepted,
      limit,
      offset,
    });

    const totalPages = limit ? Math.ceil(total / limit) : 1;

    return res.status(200).json({
      applications: rows.map((row) => toApplicationResponse(row)),
      total,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: limit ? page < totalPages : false,
        hasPrevPage: limit ? page > 1 : false,
      },
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

async function acceptApplication(req, res, next) {
  try {
    const applicationId = req.params.applicationId;
    if (!isUuid(applicationId)) {
      throw new HttpError(400, 'Invalid applicationId format');
    }

    const payload = parseAcceptInput(req.body || {});
    const application = await hrApplicationsRepository.getApplicationById(applicationId);
    if (!application) {
      throw new HttpError(404, 'Application not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, application.committee_id);
    const canAccept = await authzService.canAcceptHrApplication({
      identity: req.identity,
      membershipRole,
      governanceMode: config.hr.acceptGovernanceMode,
    });
    if (!canAccept) {
      throw new HttpError(403, 'Forbidden');
    }

    if (application.current_stage === 'accepted') {
      return res.status(200).json({ application: toApplicationResponse(application) });
    }

    if (application.current_stage !== ACCEPTABLE_STAGE) {
      throw new HttpError(400, 'Only applications in final_review can be accepted');
    }

    const iamAssignment = await iamRoleAssignmentService.assignCommitteeMemberRole({
      requestId: req.requestId,
      route: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
      applicationId,
      applicantExternalUserId: application.applicant_external_user_id,
      committeeId: application.committee_id,
    });

    if (!iamAssignment.ok) {
      if (iamAssignment.reason === 'not_configured') {
        throw new HttpError(503, 'HR acceptance is unavailable');
      }
      throw new HttpError(502, 'Failed to complete acceptance');
    }

    const acceptanceResult = await hrApplicationsRepository.acceptApplicationWithChecklist({
      applicationId,
      actorUserRefId: req.identity.userRefId,
      notes: payload.notes,
      createChecklist: false,
    });

    if (acceptanceResult.status === 'not_found') {
      throw new HttpError(404, 'Application not found');
    }

    if (acceptanceResult.status === 'already_accepted') {
      return res.status(200).json({
        application: toApplicationResponse(acceptanceResult.application),
      });
    }

    if (acceptanceResult.status === 'invalid_transition') {
      throw new HttpError(400, 'Only applications in final_review can be accepted');
    }

    logger.info({
      event: 'hr.application.accepted',
      requestId: req.requestId,
      applicationId,
      campaignId: acceptanceResult.application.campaign_id,
      committeeId: acceptanceResult.application.committee_id,
      actorUserId: req.identity.externalUserId,
    });

    const acceptedApplication = await hrApplicationsRepository.getApplicationById(applicationId);
    return res.status(200).json({
      application: toApplicationResponse(acceptedApplication),
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

    if (application.current_stage === 'accepted') {
      throw new HttpError(400, 'Application is already accepted');
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

async function listMyApplications(req, res, next) {
  try {
    const applicantUserId = req.identity?.userRefId || req.identity?.userId || req.identity?.sub || req.identity?.externalUserId;
    if (!applicantUserId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const applications = await hrApplicationsRepository.listApplicationsByApplicant(applicantUserId);
    return res.status(200).json({
      applications: applications.map((row) => toApplicationResponse(row)),
    });
  } catch (error) {
    return next(error);
  }
}

async function listOnboardingCandidates(req, res, next) {
  try {
    const campaignIdRaw = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    const committeeIdRaw = typeof req.query.committeeId === 'string' ? req.query.committeeId.trim() : '';
    const welcomeEmailSent = typeof req.query.welcomeEmailSent === 'string' ? req.query.welcomeEmailSent.trim() : 'false';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    let targetCommitteeId = null;
    let campaign = null;

    if (campaignIdRaw) {
      if (!isUuid(campaignIdRaw)) {
        throw new HttpError(400, 'Invalid campaignId format');
      }
      campaign = await hrCampaignsRepository.getCampaignById(campaignIdRaw);
      if (!campaign) {
        throw new HttpError(404, 'Campaign not found');
      }
    }

    if (committeeIdRaw) {
      if (!isUuid(committeeIdRaw)) {
        throw new HttpError(400, 'Invalid committeeId format');
      }
      targetCommitteeId = committeeIdRaw;
    }

    if (targetCommitteeId) {
      await ensureHrManageAccess(req.identity, targetCommitteeId);
    } else if (campaign) {
      const isPrivileged = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
      if (!isPrivileged) {
        const campaignCommittees = campaign.committees || [];
        let hasAccess = campaign.committee_id ? await authzService.isCommitteeLead(req.identity, campaign.committee_id) : false;
        if (!hasAccess) {
          for (const c of campaignCommittees) {
            if (await authzService.isCommitteeLead(req.identity, c.id)) {
              hasAccess = true;
              break;
            }
          }
        }
        if (!hasAccess) {
          throw new HttpError(403, 'Forbidden');
        }
      }
    } else {
      const hasBranchAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
      if (!hasBranchAccess) {
        throw new HttpError(403, 'Forbidden');
      }
    }

    const result = await hrApplicationsRepository.listOnboardingCandidates({
      committeeId: targetCommitteeId,
      campaignId: campaign ? campaign.id : null,
      welcomeEmailSent,
      search,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      summary: result.summary,
      candidates: result.candidates.map((c) => toApplicationResponse(c)),
    });
  } catch (error) {
    return next(error);
  }
}

async function markWelcomeSent(req, res, next) {
  try {
    const hasBranchAccess = authzService.isPrivilegedGlobalAccess(req.identity) || await authzService.isHrCommitteeLead(req.identity);
    if (!hasBranchAccess) {
      throw new HttpError(403, 'Forbidden: HR lead or administrator permissions required');
    }

    const applicationIds = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];
    if (applicationIds.length === 0) {
      return res.status(200).json({ success: true, updatedCount: 0, applications: [] });
    }

    for (const id of applicationIds) {
      if (!isUuid(id)) {
        throw new HttpError(400, `Invalid applicationId format: ${id}`);
      }
    }

    // Parse custom checklistSteps or checklistItems if passed, else fallback to ONBOARDING_CHECKLIST_TEMPLATE
    let checklistItems = ONBOARDING_CHECKLIST_TEMPLATE;
    const rawSteps = req.body?.checklistSteps || req.body?.checklistItems;
    if (Array.isArray(rawSteps) && rawSteps.length > 0) {
      const parsed = rawSteps
        .filter((step) => step && typeof step.title === 'string' && step.title.trim())
        .map((step, idx) => ({
          templateKey: step.id || step.templateKey || `step_${idx + 1}`,
          title: step.title.trim(),
          sortOrder: typeof step.sortOrder === 'number' ? step.sortOrder : idx + 1,
        }));
      if (parsed.length > 0) {
        checklistItems = parsed;
      }
    }

    const updatedRows = await hrApplicationsRepository.markWelcomeEmailsSent(applicationIds, {
      checklistItems,
      actorUserRefId: req.identity.userRefId,
    });

    logger.info({
      event: 'hr.application.welcome_emails_marked_sent',
      requestId: req.requestId,
      count: updatedRows.length,
      actorUserId: req.identity.externalUserId,
      checklistCount: checklistItems.length,
    });

    return res.status(200).json({
      success: true,
      updatedCount: updatedRows.length,
      applications: updatedRows.map((r) => toApplicationResponse(r)),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  acceptApplication,
  createApplication,
  listApplications,
  listMyApplications,
  listOnboardingCandidates,
  markWelcomeSent,
  rejectApplication,
  updateApplicationStage,
};

