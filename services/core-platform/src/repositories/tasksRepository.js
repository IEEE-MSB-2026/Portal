const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const { encodeCursor } = require('../utils/pagination');

async function createTask({ committeeId, title, description, assigneeUserRefId, createdByUserRefId, dueAt }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO tasks (
        id,
        committee_id,
        title,
        description,
        assignee_user_ref_id,
        created_by_user_ref_id,
        status,
        due_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'todo', $7)
      RETURNING id, committee_id, title, description, assignee_user_ref_id, created_by_user_ref_id, status, due_at, created_at, updated_at
    `,
    [id, committeeId, title, description || null, assigneeUserRefId, createdByUserRefId, dueAt || null]
  );
  return result.rows[0];
}

async function getTaskById(taskId) {
  const result = await query(
    `
      SELECT id, committee_id, title, description, assignee_user_ref_id, created_by_user_ref_id, status, due_at, created_at, updated_at
      FROM tasks
      WHERE id = $1
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

async function updateTaskStatus(taskId, status) {
  const result = await query(
    `
      UPDATE tasks
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, committee_id, title, description, assignee_user_ref_id, created_by_user_ref_id, status, due_at, created_at, updated_at
    `,
    [taskId, status]
  );
  return result.rows[0] || null;
}

async function listAssignedTasks(userRefId, { limit, cursor }) {
  const values = [userRefId, limit + 1];
  let cursorClause = '';

  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    cursorClause = 'AND (t.created_at, t.id) < ($3::timestamptz, $4::uuid)';
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
        t.status,
        t.due_at,
        t.created_at,
        t.updated_at,
        assignee.external_user_id AS assignee_external_user_id,
        creator.external_user_id AS created_by_external_user_id
      FROM tasks t
      JOIN committees c ON c.id = t.committee_id
      JOIN users_ref assignee ON assignee.id = t.assignee_user_ref_id
      JOIN users_ref creator ON creator.id = t.created_by_user_ref_id
      WHERE t.assignee_user_ref_id = $1
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
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assigneeUserId: row.assignee_external_user_id,
      createdByUserId: row.created_by_external_user_id,
    })),
    nextCursor: hasMore && lastItem
      ? encodeCursor({ createdAt: new Date(lastItem.created_at).toISOString(), id: lastItem.id })
      : null,
  };
}

async function listCommitteeTasks(committeeId, { limit, cursor }) {
  const values = [committeeId, limit + 1];
  let cursorClause = '';

  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    cursorClause = 'AND (t.created_at, t.id) < ($3::timestamptz, $4::uuid)';
  }

  const result = await query(
    `
      SELECT
        t.id,
        t.committee_id,
        t.title,
        t.description,
        t.status,
        t.due_at,
        t.created_at,
        t.updated_at,
        assignee.external_user_id AS assignee_external_user_id,
        creator.external_user_id AS created_by_external_user_id
      FROM tasks t
      JOIN users_ref assignee ON assignee.id = t.assignee_user_ref_id
      JOIN users_ref creator ON creator.id = t.created_by_user_ref_id
      WHERE t.committee_id = $1
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
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assigneeUserId: row.assignee_external_user_id,
      createdByUserId: row.created_by_external_user_id,
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
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'todo')::int AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done')::int AS done
      FROM tasks
      WHERE committee_id = $1
    `,
    [committeeId]
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
  listAssignedTasks,
  listCommitteeTasks,
  updateTaskStatus,
};
