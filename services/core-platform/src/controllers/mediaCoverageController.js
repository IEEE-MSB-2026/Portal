const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const committeesRepository = require('../repositories/committeesRepository');
const mediaCoverageRepository = require('../repositories/mediaCoverageRepository');
const tasksRepository = require('../repositories/tasksRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');

const ALLOWED_COVERAGE_STATUSES = new Set(['requested', 'accepted', 'rejected', 'completed']);
const COVERAGE_TRANSITIONS = {
  requested: new Set(['accepted', 'rejected']),
  accepted: new Set(['completed']),
  rejected: new Set([]),
  completed: new Set([]),
};

function toCoverageResponse(row) {
  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    mediaCommitteeId: row.media_committee_id,
    mediaCommitteeName: row.media_committee_name,
    title: row.title,
    description: row.description,
    eventAt: row.event_at,
    status: row.status,
    requestedByUserRefId: row.requested_by_user_ref_id,
    requestedByUserId: row.requested_by_external_user_id,
    acceptedByUserRefId: row.accepted_by_user_ref_id,
    acceptedByUserId: row.accepted_by_external_user_id,
    linkedTaskId: row.linked_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseEventDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'eventAt must be a valid ISO date-time');
  }
  return parsed.toISOString();
}

function parseCreateInput(body) {
  const committeeId = typeof body?.committeeId === 'string' ? body.committeeId.trim() : '';
  const mediaCommitteeId = typeof body?.mediaCommitteeId === 'string' ? body.mediaCommitteeId.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const eventAt = parseEventDate(body?.eventAt);

  if (!isUuid(committeeId)) {
    throw new HttpError(400, 'committeeId is required and must be a valid UUID');
  }
  if (!title) {
    throw new HttpError(400, 'title is required');
  }

  if (mediaCommitteeId && !isUuid(mediaCommitteeId)) {
    throw new HttpError(400, 'mediaCommitteeId must be a valid UUID');
  }

  return {
    committeeId,
    mediaCommitteeId: mediaCommitteeId || null,
    title,
    description: description || null,
    eventAt,
  };
}

function parseStatusInput(body) {
  const status = typeof body?.status === 'string' ? body.status.trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

  if (!ALLOWED_COVERAGE_STATUSES.has(status)) {
    throw new HttpError(400, 'status must be one of requested, accepted, rejected, completed');
  }

  return {
    status,
    notes: notes || null,
  };
}

async function ensureMediaManageAccess(identity, committeeId) {
  const membershipRole = await authzService.getMembershipRoleForCommittee(identity, committeeId);
  const canManage = authzService.canManageMediaCommittee({
    identity,
    membershipRole,
    committeeId,
  });
  if (!canManage) {
    throw new HttpError(403, 'Forbidden');
  }
}

function buildCoverageTaskDescription(coverageRequest) {
  const lines = [
    `Coverage request from committee: ${coverageRequest.committee_name}`,
    `Request title: ${coverageRequest.title}`,
  ];

  if (coverageRequest.description) {
    lines.push(`Details: ${coverageRequest.description}`);
  }
  if (coverageRequest.event_at) {
    const d = new Date(coverageRequest.event_at);
    const dateFormatted = Number.isNaN(d.getTime()) ? coverageRequest.event_at : d.toLocaleString();
    lines.push(`Event at: ${dateFormatted}`);
  }
  const requester = coverageRequest.requester_name || coverageRequest.requested_by_external_user_id || 'Committee Member';
  lines.push(`Requested by: ${requester}`);
  return lines.join('\n');
}

async function createCoverageRequest(req, res, next) {
  try {
    const payload = parseCreateInput(req.body || {});
    let mediaCommitteeId = payload.mediaCommitteeId || config.media.defaultCommitteeId;

    if (!mediaCommitteeId) {
      // Dynamic fallback: resolve media committee from database by standard slug 'media'
      const dbMediaCommittee = await committeesRepository.getCommitteeBySlug('media');
      if (dbMediaCommittee) {
        mediaCommitteeId = dbMediaCommittee.id;
      }
    }

    if (!mediaCommitteeId) {
      throw new HttpError(503, 'Media committee is not configured');
    }

    const sourceCommittee = await committeesRepository.getCommitteeById(payload.committeeId);
    if (!sourceCommittee) {
      throw new HttpError(404, 'Committee not found');
    }

    const mediaCommittee = await committeesRepository.getCommitteeById(mediaCommitteeId);
    if (!mediaCommittee) {
      throw new HttpError(404, 'Media committee not found');
    }

    await ensureMediaManageAccess(req.identity, payload.committeeId);

    const coverageRequest = await mediaCoverageRepository.createCoverageRequest({
      committeeId: payload.committeeId,
      mediaCommitteeId,
      title: payload.title,
      description: payload.description,
      eventAt: payload.eventAt,
      requestedByUserRefId: req.identity.userRefId,
    });

    await mediaCoverageRepository.createCoverageActivity({
      coverageRequestId: coverageRequest.id,
      action: 'created',
      actorUserRefId: req.identity.userRefId,
      fromStatus: null,
      toStatus: coverageRequest.status,
      notes: null,
    });

    logger.info({
      event: 'media.coverage.created',
      requestId: req.requestId,
      coverageRequestId: coverageRequest.id,
      committeeId: coverageRequest.committee_id,
      mediaCommitteeId: coverageRequest.media_committee_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(201).json({
      request: toCoverageResponse(coverageRequest),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCoverageStatus(req, res, next) {
  try {
    const requestId = req.params.requestId;
    if (!isUuid(requestId)) {
      throw new HttpError(400, 'Invalid requestId format');
    }

    const payload = parseStatusInput(req.body || {});
    const current = await mediaCoverageRepository.getCoverageRequestById(requestId);
    if (!current) {
      throw new HttpError(404, 'Coverage request not found');
    }

    await ensureMediaManageAccess(req.identity, current.media_committee_id);

    if (current.status === payload.status) {
      return res.status(200).json({
        request: toCoverageResponse(current),
      });
    }

    const allowed = COVERAGE_TRANSITIONS[current.status] || new Set();
    if (!allowed.has(payload.status)) {
      throw new HttpError(400, 'Invalid coverage status transition');
    }

    let linkedTaskId = current.linked_task_id;
    if (payload.status === 'accepted' && !linkedTaskId) {
      const linkedTask = await tasksRepository.createTask({
        committeeId: current.media_committee_id,
        title: `Coverage: ${current.title}`,
        description: buildCoverageTaskDescription(current),
        assigneeUserRefId: req.identity.userRefId,
        createdByUserRefId: req.identity.userRefId,
        dueAt: current.event_at ? new Date(current.event_at).toISOString() : null,
      });
      linkedTaskId = linkedTask.id;

      await taskActivityRepository.createTaskActivity({
        taskId: linkedTask.id,
        actorUserRefId: req.identity.userRefId,
        action: 'created',
        fromStatus: null,
        toStatus: linkedTask.status,
      });
      await taskActivityRepository.createTaskActivity({
        taskId: linkedTask.id,
        actorUserRefId: req.identity.userRefId,
        action: 'assigned',
        fromStatus: null,
        toStatus: null,
      });

      await mediaCoverageRepository.createCoverageActivity({
        coverageRequestId: current.id,
        action: 'linked_task_created',
        actorUserRefId: req.identity.userRefId,
        fromStatus: current.status,
        toStatus: payload.status,
        notes: `linkedTaskId=${linkedTask.id}`,
      });
    }

    const updated = await mediaCoverageRepository.updateCoverageStatus({
      requestId: current.id,
      status: payload.status,
      actorUserRefId: req.identity.userRefId,
      linkedTaskId,
    });

    await mediaCoverageRepository.createCoverageActivity({
      coverageRequestId: current.id,
      action: 'status_changed',
      actorUserRefId: req.identity.userRefId,
      fromStatus: current.status,
      toStatus: payload.status,
      notes: payload.notes,
    });

    logger.info({
      event: 'media.coverage.status_changed',
      requestId: req.requestId,
      coverageRequestId: current.id,
      fromStatus: current.status,
      toStatus: payload.status,
      linkedTaskId: updated.linked_task_id,
      actorUserId: req.identity.externalUserId,
    });

    return res.status(200).json({
      request: toCoverageResponse(updated),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCoverageRequest,
  updateCoverageStatus,
};
