const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createTaskActivity({ taskId, actorUserId, actorUserRefId, action, fromStatus, toStatus, details = null }) {
  const id = randomUUID();
  const targetActorId = actorUserId || actorUserRefId;

  await query(
    `
      INSERT INTO task_activities (id, task_id, actor_user_id, action, from_status, to_status, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [id, taskId, targetActorId, action, fromStatus || null, toStatus || null, details ? JSON.stringify(details) : null]
  );
}

async function listRecentActivityForUserCommittees(userId, { limit = 20 } = {}) {
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
        actor.id AS actor_user_id,
        actor.name AS actor_name
      FROM task_activities tal
      JOIN tasks t ON t.id = tal.task_id
      JOIN committee_memberships cm ON cm.committee_id = t.committee_id
      JOIN users actor ON actor.id = tal.actor_user_id
      WHERE cm.user_id = $1
      ORDER BY tal.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    committeeId: row.committee_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }));
}

module.exports = {
  createTaskActivity,
  listRecentActivityForUserCommittees,
};
