const { HttpError } = require('../utils/httpErrors');
const { isUuid } = require('../utils/ids');
const authzService = require('../services/authzService');
const assignmentsRepository = require('../repositories/assignmentsRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');

function isValidSecureUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) return false;
  const trimmed = urlString.trim();
  if (trimmed.startsWith('/local-uploads/')) return true;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function listCommitteeAssignments(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const canRead = await authzService.canReadCommittee(req.identity, committeeId);
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const assignments = await assignmentsRepository.listAssignmentsByCommittee(committeeId, {
      userId: req.identity.userRefId,
    });

    return res.status(200).json({
      assignments,
    });
  } catch (error) {
    return next(error);
  }
}

async function createCommitteeAssignment(req, res, next) {
  try {
    const committeeId = req.params.committeeId;
    if (!isUuid(committeeId)) {
      throw new HttpError(400, 'Invalid committeeId format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can create assignments');
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
    const dueDate = req.body?.dueDate ? new Date(req.body.dueDate) : null;
    const maxPoints = Number.isInteger(Number(req.body?.maxPoints)) ? Number(req.body.maxPoints) : 100;
    const attachmentUrl = req.body?.attachmentUrl ? String(req.body.attachmentUrl).trim() : null;
    const attachmentName = req.body?.attachmentName ? String(req.body.attachmentName).trim() : null;

    if (!title) {
      throw new HttpError(400, 'title is required');
    }

    if (attachmentUrl && !isValidSecureUrl(attachmentUrl)) {
      throw new HttpError(400, 'attachmentUrl must be a valid secure URL');
    }

    const assignment = await assignmentsRepository.createAssignment({
      committeeId,
      title,
      description,
      dueDate,
      maxPoints,
      attachmentUrl,
      attachmentName,
      createdByUserId: req.identity.userRefId,
    });

    await taskActivityRepository.recordCommitteeActivity({
      committeeId,
      actorUserId: req.identity.userRefId,
      activityType: 'assignment_created',
      title: `posted new assignment "${title}"`,
      details: { assignmentId: assignment.id, maxPoints },
    }).catch(() => {});

    return res.status(201).json({
      message: 'Assignment created successfully',
      assignment,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCommitteeAssignment(req, res, next) {
  try {
    const { committeeId, assignmentId } = req.params;
    if (!isUuid(committeeId) || !isUuid(assignmentId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can update assignments');
    }

    const updateData = {};
    if (req.body?.title !== undefined) {
      const t = String(req.body.title).trim();
      if (!t) throw new HttpError(400, 'title must not be empty');
      updateData.title = t;
    }
    if (req.body?.description !== undefined) {
      updateData.description = req.body.description ? String(req.body.description).trim() : null;
    }
    if (req.body?.dueDate !== undefined) {
      updateData.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }
    if (req.body?.maxPoints !== undefined) {
      updateData.maxPoints = Number(req.body.maxPoints) || 100;
    }
    if (req.body?.attachmentUrl !== undefined) {
      const url = req.body.attachmentUrl ? String(req.body.attachmentUrl).trim() : null;
      if (url && !isValidSecureUrl(url)) {
        throw new HttpError(400, 'attachmentUrl must be a valid secure URL');
      }
      updateData.attachmentUrl = url;
      updateData.attachmentName = req.body.attachmentName ? String(req.body.attachmentName).trim() : null;
    }

    const updated = await assignmentsRepository.updateAssignment(assignmentId, updateData);
    if (!updated) {
      throw new HttpError(404, 'Assignment not found');
    }

    return res.status(200).json({
      message: 'Assignment updated successfully',
      assignment: updated,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteCommitteeAssignment(req, res, next) {
  try {
    const { committeeId, assignmentId } = req.params;
    if (!isUuid(committeeId) || !isUuid(assignmentId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canDeleteCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can delete assignments');
    }

    const deleted = await assignmentsRepository.deleteAssignment(assignmentId);
    if (!deleted) {
      throw new HttpError(404, 'Assignment not found');
    }

    return res.status(200).json({
      message: 'Assignment deleted successfully',
      assignmentId,
    });
  } catch (error) {
    return next(error);
  }
}

async function submitAssignment(req, res, next) {
  try {
    const { committeeId, assignmentId } = req.params;
    if (!isUuid(committeeId) || !isUuid(assignmentId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const canRead = await authzService.canReadCommittee(req.identity, committeeId);
    if (!canRead) {
      throw new HttpError(403, 'Forbidden');
    }

    const assignment = await assignmentsRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new HttpError(404, 'Assignment not found');
    }

    const fileUrl = typeof req.body?.fileUrl === 'string' ? req.body.fileUrl.trim() : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : 'delivery-file';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

    if (!fileUrl) {
      throw new HttpError(400, 'fileUrl is required for assignment delivery');
    }

    if (!isValidSecureUrl(fileUrl)) {
      throw new HttpError(400, 'fileUrl must be a valid secure URL');
    }

    const submission = await assignmentsRepository.upsertSubmission({
      assignmentId,
      userId: req.identity.userRefId,
      fileUrl,
      fileName,
      notes,
    });

    await taskActivityRepository.recordCommitteeActivity({
      committeeId,
      actorUserId: req.identity.userRefId,
      activityType: 'assignment_submitted',
      title: `submitted delivery for assignment "${assignment.title}"`,
      details: { assignmentId, fileName },
    }).catch(() => {});

    return res.status(200).json({
      message: 'Assignment delivered successfully',
      submission,
    });
  } catch (error) {
    return next(error);
  }
}

async function listAssignmentSubmissions(req, res, next) {
  try {
    const { committeeId, assignmentId } = req.params;
    if (!isUuid(committeeId) || !isUuid(assignmentId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can view submissions');
    }

    const submissions = await assignmentsRepository.listSubmissionsForAssignment(assignmentId);

    return res.status(200).json({
      submissions,
    });
  } catch (error) {
    return next(error);
  }
}

async function gradeAssignmentSubmission(req, res, next) {
  try {
    const { committeeId, assignmentId, submissionId } = req.params;
    if (!isUuid(committeeId) || !isUuid(assignmentId) || !isUuid(submissionId)) {
      throw new HttpError(400, 'Invalid UUID format');
    }

    const membershipRole = await authzService.getMembershipRoleForCommittee(req.identity, committeeId);
    if (!authzService.canManageCommitteeContent({ identity: req.identity, membershipRole })) {
      throw new HttpError(403, 'Only committee lead can grade submissions');
    }

    const assignment = await assignmentsRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new HttpError(404, 'Assignment not found');
    }

    const grade = Number(req.body?.grade);
    const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : null;
    const status = req.body?.status || 'graded';

    if (Number.isNaN(grade) || grade < 0) {
      throw new HttpError(400, 'grade must be a non-negative number');
    }

    const maxPoints = assignment.max_points !== undefined ? assignment.max_points : assignment.maxPoints !== undefined ? assignment.maxPoints : 100;
    if (grade > maxPoints) {
      throw new HttpError(400, `grade cannot exceed max points (${maxPoints})`);
    }

    const updated = await assignmentsRepository.gradeSubmission({
      submissionId,
      grade,
      feedback,
      status,
    });

    if (!updated) {
      throw new HttpError(404, 'Submission not found');
    }

    await taskActivityRepository.recordCommitteeActivity({
      committeeId,
      actorUserId: req.identity.userRefId,
      targetUserId: updated.user_id || updated.userId,
      activityType: 'assignment_graded',
      title: `graded submission for "${assignment.title}" (${grade}/${assignment.maxPoints || assignment.max_points})`,
      details: { assignmentId, submissionId, grade, feedback },
    }).catch(() => {});

    return res.status(200).json({
      message: 'Submission graded successfully',
      submission: updated,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listCommitteeAssignments,
  createCommitteeAssignment,
  updateCommitteeAssignment,
  deleteCommitteeAssignment,
  submitAssignment,
  listAssignmentSubmissions,
  gradeAssignmentSubmission,
};
