const boardTaskRepository = require('../repositories/boardTaskRepository');
const committeeCockpitRepository = require('../repositories/committeeCockpitRepository');
const governanceVaultRepository = require('../repositories/governanceVaultRepository');
const excomRepository = require('../repositories/excomRepository');
const officerRepository = require('../repositories/officerRepository');

function isGlobalAdmin(identity) {
  if (!identity) return false;
  return identity.role === 'admin' || identity.userRef?.defaultRole === 'admin';
}

function isOfficerOrAdmin(identity) {
  if (!identity) return false;
  const role = identity.role || identity.userRef?.defaultRole;
  return ['admin', 'officer'].includes(role);
}

function assertOfficerOrAdmin(req) {
  if (!isOfficerOrAdmin(req.identity)) {
    const err = new Error('Forbidden: Executive workspace access requires officer or administrator privileges');
    err.status = 403;
    throw err;
  }
}

function assertAdmin(req) {
  if (!isGlobalAdmin(req.identity)) {
    const err = new Error('Forbidden: This operation requires branch administrator privileges');
    err.status = 403;
    throw err;
  }
}

// ----------------------------------------------------
// Tab 1: Board Kanban Tasks
// ----------------------------------------------------
async function getBoardTasks(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { status, priority } = req.query;
    const tasks = await boardTaskRepository.listBoardTasks({ status, priority });
    return res.status(200).json({ tasks });
  } catch (error) {
    return next(error);
  }
}

async function getArchivedBoardTasks(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const tasks = await boardTaskRepository.listArchivedBoardTasks();
    return res.status(200).json({ tasks });
  } catch (error) {
    return next(error);
  }
}

async function createBoardTask(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { title, description, priority, assigneeUserId, dueDate } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const actorUserId = req.identity.userRefId || req.identity.externalUserId || req.identity.userId;
    const task = await boardTaskRepository.createBoardTask({
      title,
      description,
      priority,
      assigneeUserId,
      dueDate,
      createdByUserId: actorUserId,
    });

    return res.status(201).json({
      message: 'Board task created successfully',
      task,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateBoardTask(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { id } = req.params;
    const updated = await boardTaskRepository.updateBoardTask(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Board task not found' });
    }
    return res.status(200).json({
      message: 'Board task updated successfully',
      task: updated,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteBoardTask(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { id } = req.params;
    const deleted = await boardTaskRepository.deleteBoardTask(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Board task not found' });
    }
    return res.status(200).json({
      message: 'Board task deleted successfully',
      id: deleted.id,
    });
  } catch (error) {
    return next(error);
  }
}

async function archiveBoardTask(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { id } = req.params;
    const isArchived = req.body.isArchived !== false;
    const updated = await boardTaskRepository.updateBoardTask(id, { isArchived });
    if (!updated) {
      return res.status(404).json({ error: 'Board task not found' });
    }
    return res.status(200).json({
      message: isArchived ? 'Board task archived successfully' : 'Board task restored successfully',
      task: updated,
    });
  } catch (error) {
    return next(error);
  }
}

// ----------------------------------------------------
// Tab 2: Cross-Committee Health & Progress Cockpit
// ----------------------------------------------------
async function getCockpitStats(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const data = await committeeCockpitRepository.getBranchCockpitStats();
    return res.status(200).json(data);
  } catch (error) {
    return next(error);
  }
}

// ----------------------------------------------------
// Tab 3: Governance Vault Documents
// ----------------------------------------------------
async function getDocuments(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { tag, search } = req.query;
    const documents = await governanceVaultRepository.listDocuments({ tag, search });
    return res.status(200).json({ documents });
  } catch (error) {
    return next(error);
  }
}

async function createDocument(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { title, fileUrl, fileSizeBytes, tag, description } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Document title is required' });
    }
    if (!fileUrl || !fileUrl.trim()) {
      return res.status(400).json({ error: 'Document file URL is required' });
    }

    const actorUserId = req.identity.userRefId || req.identity.externalUserId || req.identity.userId;
    const document = await governanceVaultRepository.createDocument({
      title,
      fileUrl,
      fileSizeBytes,
      tag,
      description,
      uploadedByUserId: actorUserId,
    });

    return res.status(201).json({
      message: 'Governance document added successfully',
      document,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateDocument(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { id } = req.params;
    const document = await governanceVaultRepository.updateDocument(id, req.body);
    if (!document) {
      return res.status(404).json({ error: 'Governance document not found' });
    }
    return res.status(200).json({
      message: 'Governance document updated successfully',
      document,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteDocument(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { id } = req.params;
    const deleted = await governanceVaultRepository.deleteDocument(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Governance document not found' });
    }
    return res.status(200).json({
      message: 'Governance document deleted successfully',
      id: deleted.id,
    });
  } catch (error) {
    return next(error);
  }
}

// ----------------------------------------------------
// Tab 4: Excom Internal Team & Role Assignments
// ----------------------------------------------------
async function getExcomMembers(req, res, next) {
  try {
    assertOfficerOrAdmin(req);
    const { season } = req.query;
    const members = await excomRepository.listExcomMembers({ season });
    return res.status(200).json({ members });
  } catch (error) {
    return next(error);
  }
}

async function assignExcomMember(req, res, next) {
  try {
    assertAdmin(req);
    const { userId, position, customTitle, season } = req.body;
    if (!userId || !position) {
      return res.status(400).json({ error: 'userId and position are required' });
    }

    const actorUserId = req.identity.userRefId || req.identity.externalUserId || req.identity.userId;
    const member = await excomRepository.assignExcomMember({
      userId,
      position,
      customTitle,
      season,
      appointedByUserId: actorUserId,
    });

    return res.status(201).json({
      message: 'Excom position assigned successfully',
      member,
    });
  } catch (error) {
    return next(error);
  }
}

async function removeExcomMember(req, res, next) {
  try {
    assertAdmin(req);
    const { id } = req.params;
    const result = await excomRepository.removeExcomMember(id);
    if (!result) {
      return res.status(404).json({ error: 'Excom member assignment not found' });
    }
    return res.status(200).json({
      message: 'Excom member assignment removed successfully',
      id: result.id,
    });
  } catch (error) {
    return next(error);
  }
}

async function searchCandidates(req, res, next) {
  try {
    assertAdmin(req);
    const { q } = req.query;
    const candidates = await excomRepository.searchCandidateUsers(q);
    return res.status(200).json({ candidates });
  } catch (error) {
    return next(error);
  }
}

// ----------------------------------------------------
// Public Officer Reordering (Tab 5 / About page)
// ----------------------------------------------------
async function reorderPublicOfficers(req, res, next) {
  try {
    assertAdmin(req);
    const { orderedItems } = req.body;
    if (!Array.isArray(orderedItems)) {
      return res.status(400).json({ error: 'orderedItems must be an array of { id, displayOrder }' });
    }

    await officerRepository.reorderOfficers(orderedItems);
    return res.status(200).json({
      message: 'Public officers reordered successfully',
      count: orderedItems.length,
    });
  } catch (error) {
    return next(error);
  }
}

async function setActiveSeason(req, res, next) {
  try {
    assertAdmin(req);
    const { season } = req.body;
    if (!season || typeof season !== 'string') {
      return res.status(400).json({ error: 'season is required (e.g. "2025/2026")' });
    }

    const result = await officerRepository.setActiveSeason(season);
    return res.status(200).json({
      message: `Season ${season} is now the active leadership season`,
      season: result.season,
      updatedCount: result.updatedCount,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getBoardTasks,
  getArchivedBoardTasks,
  createBoardTask,
  updateBoardTask,
  deleteBoardTask,
  archiveBoardTask,
  getCockpitStats,
  getDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getExcomMembers,
  assignExcomMember,
  removeExcomMember,
  searchCandidates,
  reorderPublicOfficers,
  setActiveSeason,
};
