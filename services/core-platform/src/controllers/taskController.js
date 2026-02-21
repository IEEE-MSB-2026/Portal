const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const usersRepository = require('../repositories/usersRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const authzService = require('../services/authzService');
const emailNotificationService = require('../services/emailNotificationService');

const ALLOWED_TASK_STATUSES = new Set(['todo', 'in_progress', 'done']);
const OWN_TRANSITIONS = {
  todo: new Set(['in_progress']),
  in_progress: new Set(['done']),
  done: new Set([]),
};

function parseTaskInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const assigneeUserId = typeof body.assigneeUserId === 'string' ? body.assigneeUserId.trim() : '';
  const dueAt = body.dueAt ? new Date(body.dueAt) : null;

  if (!title) {
    throw new HttpError(400, 'title is required');
  }
  if (!assigneeUserId) {
    throw new HttpError(400, 'assigneeUserId is required');
  }
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw new HttpError(400, 'dueAt must be a valid ISO date-time');
  }

  return {
    title,
    description: description || null,
    assigneeUserId,
    dueAt: dueAt ? dueAt.toISOString() : null,
  };
}

async function createTask(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const committee = await committeesRepository.getCommitteeById(committeeId);
    if (!committee) {
      throw new HttpError(404, 'Committee not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    const canAssign = authzService.canAssignTask({ identity: req.identity, membershipRole });
    if (!canAssign) {
      throw new HttpError(403, 'Forbidden');
    }

    const payload = parseTaskInput(req.body || {});

    const assigneeUserRef = await usersRepository.findByExternalUserId(payload.assigneeUserId);
    if (!assigneeUserRef) {
      throw new HttpError(400, 'Assignee user not found');
    }

    const isAssigneeMember = await committeesRepository.isMemberOfCommittee(assigneeUserRef.id, committeeId);
    if (!isAssigneeMember) {
      throw new HttpError(400, 'Assignee must be a member of this committee');
    }

    const task = await tasksRepository.createTask({
      committeeId,
      title: payload.title,
      description: payload.description,
      assigneeUserRefId: assigneeUserRef.id,
      createdByUserRefId: req.identity.userRefId,
      dueAt: payload.dueAt,
    });

    await taskActivityRepository.createTaskActivity({
      taskId: task.id,
      actorUserRefId: req.identity.userRefId,
      action: 'created',
      fromStatus: null,
      toStatus: task.status,
    });

    await taskActivityRepository.createTaskActivity({
      taskId: task.id,
      actorUserRefId: req.identity.userRefId,
      action: 'assigned',
      fromStatus: null,
      toStatus: null,
    });

    logger.info({
      event: 'task.created',
      requestId: req.requestId,
      taskId: task.id,
      committeeId,
      actorUserId: req.identity.externalUserId,
      assigneeUserId: payload.assigneeUserId,
    });

    const notificationResult = await emailNotificationService.sendTaskAssignmentNotification({
      requestId: req.requestId,
      route: req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`,
      committeeName: committee.name,
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      taskDueAt: task.due_at,
      assigneeExternalUserId: payload.assigneeUserId,
      assigneeEmail: assigneeUserRef.email,
      actorExternalUserId: req.identity.externalUserId,
    });

    if (!notificationResult.ok) {
      logger.warn({
        event: 'task.assignment.notification.undelivered',
        requestId: req.requestId,
        taskId: task.id,
        targetEmail: notificationResult.recipientEmail || assigneeUserRef.email || null,
        reason: notificationResult.reason,
        statusCode: notificationResult.statusCode,
      }, 'Task assignment email notification was skipped or failed');
    }

    return res.status(201).json({
      task: {
        id: task.id,
        committeeId: task.committee_id,
        title: task.title,
        description: task.description,
        status: task.status,
        dueAt: task.due_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        assigneeUserId: payload.assigneeUserId,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateTaskStatus(req, res, next) {
  try {
    const taskId = req.params.taskId;
    if (!isUuid(taskId)) {
      throw new HttpError(400, 'Invalid taskId format');
    }

    const newStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (!ALLOWED_TASK_STATUSES.has(newStatus)) {
      throw new HttpError(400, 'Invalid task status');
    }

    const task = await tasksRepository.getTaskById(taskId);
    if (!task) {
      throw new HttpError(404, 'Task not found');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, task.committee_id);
    if (!membershipRole) {
      throw new HttpError(404, 'Task not found');
    }

    const permission = authzService.canUpdateTaskStatus({
      identity: req.identity,
      membershipRole,
      task,
    });

    if (!permission.allowed) {
      throw new HttpError(403, 'Forbidden');
    }

    if (task.status === newStatus) {
      throw new HttpError(400, 'Task status is already set to this value');
    }

    if (permission.mode === 'own') {
      const allowedNextStates = OWN_TRANSITIONS[task.status] || new Set();
      if (!allowedNextStates.has(newStatus)) {
        throw new HttpError(400, 'Invalid task status transition');
      }
    }

    const updatedTask = await tasksRepository.updateTaskStatus(task.id, newStatus);

    await taskActivityRepository.createTaskActivity({
      taskId: updatedTask.id,
      actorUserRefId: req.identity.userRefId,
      action: 'status_changed',
      fromStatus: task.status,
      toStatus: newStatus,
    });

    logger.info({
      event: 'task.status_changed',
      requestId: req.requestId,
      taskId: updatedTask.id,
      committeeId: updatedTask.committee_id,
      actorUserId: req.identity.externalUserId,
      fromStatus: task.status,
      toStatus: newStatus,
    });

    return res.status(200).json({
      task: {
        id: updatedTask.id,
        committeeId: updatedTask.committee_id,
        title: updatedTask.title,
        description: updatedTask.description,
        status: updatedTask.status,
        dueAt: updatedTask.due_at,
        createdAt: updatedTask.created_at,
        updatedAt: updatedTask.updated_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createTask,
  updateTaskStatus,
};
