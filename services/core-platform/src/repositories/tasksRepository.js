const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const { encodeCursor } = require('../utils/pagination');

const ALLOWED_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);

function normalizePriority(p) {
  if (typeof p === 'string' && ALLOWED_PRIORITIES.has(p.toLowerCase())) {
    return p.toLowerCase();
  }
  return 'medium';
}

async function createTask({
  committeeId,
  title,
  description,
  priority,
  assigneeUserId,
  assigneeUserRefId,
  createdByUserId,
  createdByUserRefId,
  dueAt,
  dueDate,
}) {
  const id = randomUUID();
  const targetAssigneeId = assigneeUserId || assigneeUserRefId;
  const targetCreatorId = createdByUserId || createdByUserRefId;
  const targetDueDate = dueAt || dueDate || null;
  const targetPriority = normalizePriority(priority);

  const result = await query(
    `
      INSERT INTO tasks (
        id,
        committee_id,
        title,
        description,
        priority,
        is_archived,
        assignee_user_id,
        created_by_user_id,
        status,
        due_date
      ) VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, 'todo', $8)
      RETURNING id, committee_id, title, description, priority, is_archived, assignee_user_id, created_by_user_id, status, due_date AS due_at, created_at, updated_at
    `,
    [id, committeeId, title, description || null, targetPriority, targetAssigneeId, targetCreatorId, targetDueDate]
  );

  const row = result.rows[0];
  return {
    ...row,
    priority: row.priority || 'medium',
    isArchived: row.is_archived || false,
    assigneeUserRefId: row.assignee_user_id,
    createdByUserRefId: row.created_by_user_id,
    assigneeUserId: row.assignee_user_id,
    createdByUserId: row.created_by_user_id,
  };
}

async function getTaskById(taskId) {
  const result = await query(
    `
      SELECT id, committee_id, title, description, priority, is_archived, assignee_user_id, created_by_user_id, status, due_date AS due_at, created_at, updated_at
      FROM tasks
      WHERE id = $1
    `,
    [taskId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    priority: row.priority || 'medium',
    isArchived: row.is_archived || false,
    assigneeUserRefId: row.assignee_user_id,
    createdByUserRefId: row.created_by_user_id,
    assigneeUserId: row.assignee_user_id,
    createdByUserId: row.created_by_user_id,
  };
}

async function updateTask(taskId, { title, description, priority, assigneeUserId, dueAt }) {
  const updates = [];
  const values = [taskId];
  let idx = 2;

  if (title !== undefined) {
    updates.push(`title = $${idx++}`);
    values.push(title);
  }
  if (description !== undefined) {
    updates.push(`description = $${idx++}`);
    values.push(description || null);
  }
  if (priority !== undefined) {
    updates.push(`priority = $${idx++}`);
    values.push(normalizePriority(priority));
  }
  if (assigneeUserId !== undefined) {
    updates.push(`assignee_user_id = $${idx++}`);
    values.push(assigneeUserId);
  }
  if (dueAt !== undefined) {
    updates.push(`due_date = $${idx++}`);
    values.push(dueAt || null);
  }

  updates.push(`updated_at = NOW()`);

  const result = await query(
    `
      UPDATE tasks
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING id, committee_id, title, description, priority, is_archived, assignee_user_id, created_by_user_id, status, due_date AS due_at, created_at, updated_at
    `,
    values
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    priority: row.priority || 'medium',
    isArchived: row.is_archived || false,
    assigneeUserRefId: row.assignee_user_id,
    createdByUserRefId: row.created_by_user_id,
    assigneeUserId: row.assignee_user_id,
    createdByUserId: row.created_by_user_id,
  };
}

async function updateTaskStatus(taskId, status) {
  const result = await query(
    `
      UPDATE tasks
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, committee_id, title, description, priority, is_archived, assignee_user_id, created_by_user_id, status, due_date AS due_at, created_at, updated_at
    `,
    [taskId, status]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    priority: row.priority || 'medium',
    isArchived: row.is_archived || false,
    assigneeUserRefId: row.assignee_user_id,
    createdByUserRefId: row.created_by_user_id,
    assigneeUserId: row.assignee_user_id,
    createdByUserId: row.created_by_user_id,
  };
}

async function archiveTask(taskId, isArchived = true) {
  const result = await query(
    `
      UPDATE tasks
      SET is_archived = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, committee_id, title, description, priority, is_archived, assignee_user_id, created_by_user_id, status, due_date AS due_at, created_at, updated_at
    `,
    [taskId, Boolean(isArchived)]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    priority: row.priority || 'medium',
    isArchived: row.is_archived || false,
    assigneeUserRefId: row.assignee_user_id,
    createdByUserRefId: row.created_by_user_id,
    assigneeUserId: row.assignee_user_id,
    createdByUserId: row.created_by_user_id,
  };
}

async function deleteTask(taskId) {
  const result = await query(
    `
      DELETE FROM tasks
      WHERE id = $1
      RETURNING id, committee_id
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

async function listAssignedTasks(userId, { limit, cursor, isArchived = false }) {
  const values = [userId, limit + 1, Boolean(isArchived)];
  let cursorClause = '';

  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    cursorClause = 'AND (t.created_at, t.id) < ($4::timestamptz, $5::uuid)';
  }

  const result = await query(
    `
      SELECT
        t.id,
        t.committee_id,
        c.slug AS committee_slug,
        c.name AS committee_name,
        t.title,
        t.description,
        t.priority,
        t.is_archived,
        t.status,
        t.due_date AS due_at,
        t.created_at,
        t.updated_at,
        assignee.id AS assignee_external_user_id,
        assignee.name AS assignee_name,
        creator.id AS created_by_external_user_id,
        creator.name AS creator_name
      FROM tasks t
      JOIN committees c ON c.id = t.committee_id
      JOIN users assignee ON assignee.id = t.assignee_user_id
      JOIN users creator ON creator.id = t.created_by_user_id
      WHERE t.assignee_user_id = $1
        AND t.is_archived = $3
      ${cursorClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const items = hasMore ? result.rows.slice(0, limit) : result.rows;
  const lastItem = items[items.length - 1];

  return {
    items: items.map((row) => ({
      id: row.id,
      committeeId: row.committee_id,
      committeeSlug: row.committee_slug,
      committeeName: row.committee_name,
      title: row.title,
      description: row.description,
      priority: row.priority || 'medium',
      isArchived: row.is_archived || false,
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assigneeUserId: row.assignee_external_user_id,
      assigneeName: row.assignee_name,
      createdByUserId: row.created_by_external_user_id,
      creatorName: row.creator_name,
    })),
    nextCursor: hasMore && lastItem
      ? encodeCursor({ createdAt: new Date(lastItem.created_at).toISOString(), id: lastItem.id })
      : null,
  };
}

async function listCommitteeTasks(committeeId, { limit, cursor, isArchived = false }) {
  const values = [committeeId, limit + 1, Boolean(isArchived)];
  let cursorClause = '';

  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    cursorClause = 'AND (t.created_at, t.id) < ($4::timestamptz, $5::uuid)';
  }

  const result = await query(
    `
      SELECT
        t.id,
        t.committee_id,
        t.title,
        t.description,
        t.priority,
        t.is_archived,
        t.status,
        t.due_date AS due_at,
        t.created_at,
        t.updated_at,
        assignee.id AS assignee_external_user_id,
        assignee.name AS assignee_name,
        creator.id AS created_by_external_user_id,
        creator.name AS creator_name
      FROM tasks t
      JOIN users assignee ON assignee.id = t.assignee_user_id
      JOIN users creator ON creator.id = t.created_by_user_id
      WHERE t.committee_id = $1
        AND t.is_archived = $3
      ${cursorClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const items = hasMore ? result.rows.slice(0, limit) : result.rows;
  const lastItem = items[items.length - 1];

  return {
    items: items.map((row) => ({
      id: row.id,
      committeeId: row.committee_id,
      title: row.title,
      description: row.description,
      priority: row.priority || 'medium',
      isArchived: row.is_archived || false,
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assigneeUserId: row.assignee_external_user_id,
      assigneeName: row.assignee_name,
      createdByUserId: row.created_by_external_user_id,
      creatorName: row.creator_name,
    })),
    nextCursor: hasMore && lastItem
      ? encodeCursor({ createdAt: new Date(lastItem.created_at).toISOString(), id: lastItem.id })
      : null,
  };
}

async function getCommitteeTaskSummary(committeeId) {
  const result = await query(
    `
      SELECT
        COUNT(*) FILTER (WHERE is_archived = FALSE)::int AS total,
        COUNT(*) FILTER (WHERE status = 'todo' AND is_archived = FALSE)::int AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND is_archived = FALSE)::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done' AND is_archived = FALSE)::int AS done,
        COUNT(*) FILTER (WHERE is_archived = TRUE)::int AS archived
      FROM tasks
      WHERE committee_id = $1
    `,
    [committeeId]
  );

  const row = result.rows[0] || { total: 0, todo: 0, in_progress: 0, done: 0, archived: 0 };
  return {
    total: row.total,
    todo: row.todo,
    inProgress: row.in_progress,
    done: row.done,
    archived: row.archived || 0,
  };
}

async function getTaskStatusCountsForUser(userId) {
  const result = await query(
    `
      SELECT
        COUNT(*) FILTER (WHERE is_archived = FALSE)::int AS total,
        COUNT(*) FILTER (WHERE status = 'todo' AND is_archived = FALSE)::int AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND is_archived = FALSE)::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done' AND is_archived = FALSE)::int AS done
      FROM tasks
      WHERE assignee_user_id = $1
    `,
    [userId]
  );

  const row = result.rows[0] || { total: 0, todo: 0, in_progress: 0, done: 0 };
  return {
    total: row.total,
    todo: row.todo,
    inProgress: row.in_progress,
    done: row.done,
  };
}

module.exports = {
  createTask,
  getCommitteeTaskSummary,
  getTaskById,
  getTaskStatusCountsForUser,
  listAssignedTasks,
  listCommitteeTasks,
  updateTask,
  updateTaskStatus,
  archiveTask,
  deleteTask,
};
