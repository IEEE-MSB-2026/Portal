const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

const ALLOWED_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);
const ALLOWED_STATUSES = new Set(['todo', 'in_progress', 'done']);

function normalizePriority(p) {
  if (typeof p === 'string' && ALLOWED_PRIORITIES.has(p.toLowerCase())) {
    return p.toLowerCase();
  }
  return 'medium';
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority || 'medium',
    isArchived: Boolean(row.is_archived),
    isBoardTask: true,
    dueDate: row.due_date,
    dueAt: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name || null,
    assigneeAvatar: row.assignee_avatar || null,
    assigneeEmail: row.assignee_email || null,
    createdByUserId: row.created_by_user_id,
    creatorName: row.creator_name || null,
  };
}

async function listBoardTasks({ status, priority } = {}) {
  const conditions = ['t.is_board_task = TRUE', 't.is_archived = FALSE'];
  const values = [];

  if (status && ALLOWED_STATUSES.has(status.toLowerCase())) {
    values.push(status.toLowerCase());
    conditions.push(`t.status = $${values.length}`);
  }

  if (priority && ALLOWED_PRIORITIES.has(priority.toLowerCase())) {
    values.push(priority.toLowerCase());
    conditions.push(`t.priority = $${values.length}`);
  }

  const sql = `
    SELECT
      t.id, t.title, t.description, t.status, t.priority, t.is_archived,
      t.assignee_user_id, t.created_by_user_id, t.due_date, t.created_at, t.updated_at,
      u_assignee.name AS assignee_name, u_assignee.avatar_url AS assignee_avatar, u_assignee.email AS assignee_email,
      u_creator.name AS creator_name
    FROM tasks t
    LEFT JOIN users u_assignee ON u_assignee.id = t.assignee_user_id
    LEFT JOIN users u_creator ON u_creator.id = t.created_by_user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.created_at DESC
  `;

  const result = await query(sql, values);
  return result.rows.map(mapTaskRow);
}

async function listArchivedBoardTasks() {
  const sql = `
    SELECT
      t.id, t.title, t.description, t.status, t.priority, t.is_archived,
      t.assignee_user_id, t.created_by_user_id, t.due_date, t.created_at, t.updated_at,
      u_assignee.name AS assignee_name, u_assignee.avatar_url AS assignee_avatar, u_assignee.email AS assignee_email,
      u_creator.name AS creator_name
    FROM tasks t
    LEFT JOIN users u_assignee ON u_assignee.id = t.assignee_user_id
    LEFT JOIN users u_creator ON u_creator.id = t.created_by_user_id
    WHERE t.is_board_task = TRUE AND t.is_archived = TRUE
    ORDER BY t.updated_at DESC
  `;

  const result = await query(sql);
  return result.rows.map(mapTaskRow);
}

async function getBoardTaskById(id) {
  const sql = `
    SELECT
      t.id, t.title, t.description, t.status, t.priority, t.is_archived,
      t.assignee_user_id, t.created_by_user_id, t.due_date, t.created_at, t.updated_at,
      u_assignee.name AS assignee_name, u_assignee.avatar_url AS assignee_avatar, u_assignee.email AS assignee_email,
      u_creator.name AS creator_name
    FROM tasks t
    LEFT JOIN users u_assignee ON u_assignee.id = t.assignee_user_id
    LEFT JOIN users u_creator ON u_creator.id = t.created_by_user_id
    WHERE t.id = $1 AND t.is_board_task = TRUE
  `;

  const result = await query(sql, [id]);
  return mapTaskRow(result.rows[0]);
}

async function createBoardTask({
  title,
  description,
  priority,
  assigneeUserId,
  createdByUserId,
  dueDate,
}) {
  const id = randomUUID();
  const targetPriority = normalizePriority(priority);

  const sql = `
    INSERT INTO tasks (
      id,
      committee_id,
      is_board_task,
      title,
      description,
      priority,
      status,
      is_archived,
      assignee_user_id,
      created_by_user_id,
      due_date
    ) VALUES ($1, NULL, TRUE, $2, $3, $4, 'todo', FALSE, $5, $6, $7)
    RETURNING id
  `;

  await query(sql, [
    id,
    title.trim(),
    description ? description.trim() : null,
    targetPriority,
    assigneeUserId || null,
    createdByUserId || null,
    dueDate || null,
  ]);

  return getBoardTaskById(id);
}

async function updateBoardTask(id, data) {
  const updates = [];
  const values = [];

  if (data.title !== undefined) {
    values.push(data.title.trim());
    updates.push(`title = $${values.length}`);
  }

  if (data.description !== undefined) {
    values.push(data.description ? data.description.trim() : null);
    updates.push(`description = $${values.length}`);
  }

  if (data.status !== undefined) {
    const s = data.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      throw new Error(`Invalid status: ${data.status}. Must be one of: todo, in_progress, done`);
    }
    values.push(s);
    updates.push(`status = $${values.length}`);
  }

  if (data.priority !== undefined) {
    values.push(normalizePriority(data.priority));
    updates.push(`priority = $${values.length}`);
  }

  if (data.assigneeUserId !== undefined) {
    values.push(data.assigneeUserId || null);
    updates.push(`assignee_user_id = $${values.length}`);
  }

  if (data.dueDate !== undefined || data.dueAt !== undefined) {
    values.push(data.dueDate || data.dueAt || null);
    updates.push(`due_date = $${values.length}`);
  }

  if (data.isArchived !== undefined) {
    values.push(Boolean(data.isArchived));
    updates.push(`is_archived = $${values.length}`);
  }

  if (updates.length === 0) {
    return getBoardTaskById(id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE tasks
    SET ${updates.join(', ')}
    WHERE id = $${values.length} AND is_board_task = TRUE
    RETURNING id
  `;

  const result = await query(sql, values);
  if (result.rows.length === 0) return null;

  return getBoardTaskById(id);
}

async function deleteBoardTask(id) {
  const sql = `DELETE FROM tasks WHERE id = $1 AND is_board_task = TRUE RETURNING id`;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

module.exports = {
  listBoardTasks,
  listArchivedBoardTasks,
  getBoardTaskById,
  createBoardTask,
  updateBoardTask,
  deleteBoardTask,
};
