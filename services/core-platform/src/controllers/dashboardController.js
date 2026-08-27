const usersRepository = require('../repositories/usersRepository');
const committeesRepository = require('../repositories/committeesRepository');
const tasksRepository = require('../repositories/tasksRepository');
const taskActivityRepository = require('../repositories/taskActivityRepository');
const prAnnouncementsRepository = require('../repositories/prAnnouncementsRepository');
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

    const [userRef, committees, assignedTasks, recentActivity, recentAnnouncements] = await Promise.all([
      usersRepository.findByExternalUserId(req.identity.externalUserId),
      committeesRepository.listCommitteesForUser(req.identity.userRefId),
      tasksRepository.listAssignedTasks(req.identity.userRefId, { limit, cursor }),
      taskActivityRepository.listRecentActivityForUserCommittees(req.identity.userRefId, { limit: 20 }),
      prAnnouncementsRepository.listAnnouncements({ limit: 10 }),
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
      },
      committees,
      tasks: assignedTasks,
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
  updateMyAvatar,
  updateMyProfile,
};
