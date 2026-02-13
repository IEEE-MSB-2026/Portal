const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createTaskActivity({ taskId, actorUserRefId, action, fromStatus, toStatus }) {
  const id = randomUUID();

  await query(
    `
      INSERT INTO task_activity_log (id, task_id, actor_user_ref_id, action, from_status, to_status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [id, taskId, actorUserRefId, action, fromStatus || null, toStatus || null]
  );
}

async function listRecentActivityForUserCommittees(userRefId, { limit = 20 } = {}) {
  const result = await query(
    `
      SELECT
        tal.id,
        tal.task_id,
        tal.action,
        tal.from_status,
        tal.to_status,
        tal.created_at,
        t.committee_id,
        actor.external_user_id AS actor_user_id
      FROM task_activity_log tal
      JOIN tasks t ON t.id = tal.task_id
      JOIN committee_memberships cm ON cm.committee_id = t.committee_id
      JOIN users_ref actor ON actor.id = tal.actor_user_ref_id
      WHERE cm.user_ref_id = $1
      ORDER BY tal.created_at DESC
      LIMIT $2
    `,
    [userRefId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    committeeId: row.committee_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
  }));
}

module.exports = {
  createTaskActivity,
  listRecentActivityForUserCommittees,
};
