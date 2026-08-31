const usersRepository = require('../repositories/usersRepository');
const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const prAnnouncementsRepository = require('../repositories/prAnnouncementsRepository');
const committeeAnnouncementsRepository = require('../repositories/committeeAnnouncementsRepository');
const assignmentsRepository = require('../repositories/assignmentsRepository');
const authzService = require('../services/authzService');
const { decodeCursor, parseLimit } = require('../utils/pagination');
const { HttpError } = require('../utils/httpErrors');

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

async function getMyDashboard(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const cursor = decodeCursor(req.query.cursor);

    let userRef = req.identity.userRef;
    if (!userRef) {
      userRef = await usersRepository.findByExternalUserId(req.identity.externalUserId);
    }

    const isGlobalAdmin = req.identity.role === 'admin' || userRef?.defaultRole === 'admin';
    const isOfficer = req.identity.role === 'officer' || userRef?.defaultRole === 'officer';
    const isHRLead = await authzService.isHrCommitteeLead(req.identity);

    let [directCommittees, assignedTasks, recentActivity, recentAnnouncements, taskStats] = await Promise.all([
      committeesRepository.listCommitteesForUser(req.identity.userRefId),
      tasksRepository.listAssignedTasks(req.identity.userRefId, { limit, cursor }),
      taskActivityRepository.listRecentActivityForUserCommittees(req.identity.userRefId, { limit: 20 }),
      prAnnouncementsRepository.listAnnouncements({ limit: 10 }),
      tasksRepository.getTaskStatusCountsForUser(req.identity.userRefId),
    ]);

    let committees = directCommittees || [];

    if (isGlobalAdmin || isOfficer || isHRLead) {
      const allActiveCommittees = await committeesRepository.listPublicCommittees();
      const directMembershipMap = new Map(committees.map((c) => [c.id, c]));

      committees = allActiveCommittees.map((c) => {
        const direct = directMembershipMap.get(c.id);
        if (direct) {
          return {
            ...c,
            roleInCommittee: direct.roleInCommittee,
          };
        }
        if (isGlobalAdmin) {
          return {
            ...c,
            roleInCommittee: 'admin',
          };
        }
        return {
          ...c,
          roleInCommittee: 'hr',
        };
      });
    }

    const committeeIds = committees.map((c) => c.id);

    const [committeeAnnouncements, pendingAssignments] = await Promise.all([
      committeeAnnouncementsRepository.listAnnouncementsForCommittees(committeeIds, { limit: 10 }),
      assignmentsRepository.listPendingAssignmentsForUser(req.identity.userRefId, committeeIds),
    ]);

    return res.status(200).json({
      user: {
        userId: req.identity.externalUserId,
        email: req.identity.email,
        role: req.identity.role,
        scopeType: req.identity.scopeType,
        scopeId: req.identity.scopeId,
        avatarUrl: userRef?.avatarUrl || null,
        membershipId: userRef?.membershipId || null,
        createdAt: userRef?.createdAt || null,
      },
      committees,
      tasks: assignedTasks,
      taskStats: taskStats || { total: 0, todo: 0, inProgress: 0, done: 0 },
      pendingAssignments: pendingAssignments || [],
      committeeAnnouncements: committeeAnnouncements || [],
      recentActivity,
      recentAnnouncements: recentAnnouncements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        category: a.category,
        imageUrl: a.image_url,
        isPinned: a.is_pinned,
        authorName: a.author_name,
        visibility: a.visibility,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMyAvatar(req, res, next) {
  try {
    let avatarUrl = null;
    let cloudinaryPublicId = null;
    let cloudinaryAssetId = null;

    if (Array.isArray(req.body?.files)) {
      const avatarFile = req.body.files.find((f) => f.identifier === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.fileurl || avatarFile.fileUrl || avatarFile.url;
        cloudinaryPublicId = avatarFile.cloudinaryPublicId || avatarFile.cloudinary_public_id || null;
        cloudinaryAssetId = avatarFile.cloudinaryAssetId || avatarFile.cloudinary_asset_id || null;
      }
    }

    // Fallback for direct properties if files array was not passed
    if (!avatarUrl && req.body?.avatarUrl) {
      avatarUrl = req.body.avatarUrl;
      cloudinaryPublicId = req.body.cloudinaryPublicId || null;
      cloudinaryAssetId = req.body.cloudinaryAssetId || null;
    }

    if (!avatarUrl || !isValidSecureUrl(avatarUrl)) {
      throw new HttpError(400, 'avatarUrl must be a valid secure URL');
    }

    const updated = await usersRepository.updateUserAvatar(req.identity.userRefId, {
      avatarUrl: avatarUrl.trim(),
      cloudinaryPublicId: cloudinaryPublicId || null,
      cloudinaryAssetId: cloudinaryAssetId || null,
    });

    return res.status(200).json({
      message: 'Avatar updated successfully',
      avatarUrl: updated.avatarUrl,
      cloudinaryPublicId: updated.cloudinaryPublicId,
      cloudinaryAssetId: updated.cloudinaryAssetId,
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyProfile(req, res, next) {
  try {
    const userRef = await usersRepository.findByExternalUserId(req.identity.externalUserId);
    if (!userRef) {
      throw new HttpError(404, 'User not found');
    }
    return res.status(200).json({
      user: {
        userId: userRef.externalUserId,
        email: userRef.email,
        name: userRef.name,
        avatarUrl: userRef.avatarUrl,
        membershipId: userRef.membershipId,
        createdAt: userRef.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyStats(req, res, next) {
  try {
    const [userRef, committees, taskStats] = await Promise.all([
      usersRepository.findByExternalUserId(req.identity.externalUserId),
      committeesRepository.listCommitteesForUser(req.identity.userRefId),
      tasksRepository.getTaskStatusCountsForUser(req.identity.userRefId),
    ]);

    const committeeIds = (committees || []).map((c) => c.id);
    const pendingAssignments = await assignmentsRepository.listPendingAssignmentsForUser(
      req.identity.userRefId,
      committeeIds
    );

    const totalAssignments = (pendingAssignments || []).length;
    const submittedAssignments = (pendingAssignments || []).filter((a) => a.isSubmitted).length;
    const gradedAssignments = (pendingAssignments || []).filter((a) => a.submissionGrade !== null && a.submissionGrade !== undefined).length;
    const unsubmittedAssignments = totalAssignments - submittedAssignments;

    const createdAt = userRef?.createdAt ? new Date(userRef.createdAt) : new Date();
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - createdAt.getTime());
    const daysMember = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    return res.status(200).json({
      tasks: taskStats || { total: 0, todo: 0, inProgress: 0, done: 0, archived: 0 },
      assignments: {
        total: totalAssignments,
        pending: unsubmittedAssignments,
        submitted: submittedAssignments,
        graded: gradedAssignments,
      },
      committeesCount: (committees || []).length,
      daysMember,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMyProfile(req, res, next) {
  try {
    const { membershipId, membership_id, name } = req.body || {};
    const memId = membershipId !== undefined ? membershipId : membership_id;

    const updated = await usersRepository.updateUserProfile(req.identity.userRefId, {
      membershipId: memId,
      name,
    });

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        userId: updated.externalUserId,
        email: updated.email,
        avatarUrl: updated.avatarUrl,
        membershipId: updated.membershipId,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyDashboard,
  getMyStats,
  getMyProfile,
  updateMyAvatar,
  updateMyProfile,
};
