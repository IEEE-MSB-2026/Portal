const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function recordCommitteeActivity({
  committeeId,
  actorUserId,
  targetUserId = null,
  activityType,
  title,
  details = null,
}) {
  const id = randomUUID();
  await query(
    `
      INSERT INTO committee_activities (
        id,
        committee_id,
        actor_user_id,
        target_user_id,
        activity_type,
        title,
        details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      id,
      committeeId,
      actorUserId,
      targetUserId,
      activityType,
      title,
      details ? JSON.stringify(details) : null,
    ]
  );
  return id;
}

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
        ca.id,
        ca.committee_id,
        c.name AS committee_name,
        ca.actor_user_id,
        actor.name AS actor_name,
        ca.target_user_id,
        target.name AS target_name,
        ca.activity_type,
        ca.title,
        ca.details,
        ca.created_at
      FROM committee_activities ca
      JOIN committees c ON c.id = ca.committee_id
      JOIN committee_memberships cm ON cm.committee_id = ca.committee_id AND cm.user_id = $1
      JOIN users actor ON actor.id = ca.actor_user_id
      LEFT JOIN users target ON target.id = ca.target_user_id
      WHERE (
        -- General committee updates
        ca.activity_type IN ('announcement_posted', 'assignment_created', 'task_created', 'task_completed', 'resource_added')
        OR
        -- Assignment submitted: only visible to leads
        (ca.activity_type = 'assignment_submitted' AND cm.role_in_committee = 'lead')
        OR
        -- Assignment graded: only visible to the target graded member
        (ca.activity_type = 'assignment_graded' AND ca.target_user_id = $1)
      )
      ORDER BY ca.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    targetUserId: row.target_user_id,
    targetName: row.target_name,
    activityType: row.activity_type,
    title: row.title,
    details: row.details,
    createdAt: row.created_at,
  }));
}

module.exports = {
  recordCommitteeActivity,
  createTaskActivity,
  listRecentActivityForUserCommittees,
};
