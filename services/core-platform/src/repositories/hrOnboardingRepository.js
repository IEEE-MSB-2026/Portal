const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function runDb(client, text, params) {
  if (client && typeof client.query === 'function') {
    return client.query(text, params);
  }
  return query(text, params);
}

async function createChecklistItems({
  applicationId,
  committeeId,
  assigneeUserId,
  assigneeUserRefId,
  createdByUserId,
  createdByUserRefId,
  checklistItems,
  client,
}) {
  const targetUserId = assigneeUserId || assigneeUserRefId;
  const targetCreatorId = createdByUserId || createdByUserRefId || null;
  const insertedRows = [];

  for (const item of (checklistItems || [])) {
    const result = await runDb(
      client,
      `
        INSERT INTO hr_onboarding_items (
          id,
          application_id,
          committee_id,
          assignee_user_id,
          template_key,
          title,
          sort_order,
          status,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'todo', $8)
        ON CONFLICT (application_id, template_key)
        DO NOTHING
        RETURNING
          id,
          application_id,
          committee_id,
          assignee_user_id,
          assignee_user_id AS assignee_user_ref_id,
          template_key,
          title,
          sort_order,
          status,
          completed_at,
          completed_by_user_id,
          completed_by_user_id AS completed_by_user_ref_id,
          created_by_user_id,
          created_at,
          updated_at
      `,
      [
        randomUUID(),
        applicationId,
        committeeId,
        targetUserId,
        item.templateKey || item.template_key || item.title,
        item.title,
        item.sortOrder || item.sort_order || 0,
        targetCreatorId,
      ]
    );

    if (result.rows[0]) {
      insertedRows.push(result.rows[0]);
    }
  }

  return insertedRows;
}

async function listOnboardingItemsByAssignee({ assigneeUserId, assigneeUserRefId, committeeIds = null }) {
  const targetUserId = assigneeUserId || assigneeUserRefId;
  const values = [targetUserId];
  let whereClause = 'WHERE oi.assignee_user_id = $1';

  if (Array.isArray(committeeIds)) {
    if (committeeIds.length === 0) return [];
    const placeholders = committeeIds.map((_, index) => `$${values.length + index + 1}`);
    values.push(...committeeIds);
    whereClause += ` AND oi.committee_id IN (${placeholders.join(', ')})`;
  }

  const result = await query(
    `
      SELECT
        oi.id,
        oi.application_id,
        oi.committee_id,
        oi.assignee_user_id,
        oi.assignee_user_id AS assignee_user_ref_id,
        oi.template_key,
        oi.title,
        oi.sort_order,
        oi.status,
        oi.completed_at,
        oi.completed_by_user_id,
        oi.completed_by_user_id AS completed_by_user_ref_id,
        oi.created_by_user_id,
        oi.created_at,
        oi.updated_at,
        c.name AS committee_name,
        au.id AS assignee_external_user_id,
        au.name AS assignee_name,
        cau.id AS completed_by_external_user_id
      FROM hr_onboarding_items oi
      JOIN committees c ON c.id = oi.committee_id
      JOIN users au ON au.id = oi.assignee_user_id
      LEFT JOIN users cau ON cau.id = oi.completed_by_user_id
      ${whereClause}
      ORDER BY oi.sort_order ASC, oi.created_at ASC
    `,
    values
  );

  return result.rows;
}

async function getOnboardingItemById(itemId) {
  const result = await query(
    `
      SELECT
        oi.id,
        oi.application_id,
        oi.committee_id,
        oi.assignee_user_id,
        oi.assignee_user_id AS assignee_user_ref_id,
        oi.template_key,
        oi.title,
        oi.sort_order,
        oi.status,
        oi.completed_at,
        oi.completed_by_user_id,
        oi.completed_by_user_id AS completed_by_user_ref_id,
        oi.created_by_user_id,
        oi.created_at,
        oi.updated_at,
        c.name AS committee_name,
        au.id AS assignee_external_user_id,
        au.name AS assignee_name,
        au.email AS assignee_email,
        cau.id AS completed_by_external_user_id
      FROM hr_onboarding_items oi
      JOIN committees c ON c.id = oi.committee_id
      JOIN users au ON au.id = oi.assignee_user_id
      LEFT JOIN users cau ON cau.id = oi.completed_by_user_id
      WHERE oi.id = $1
    `,
    [itemId]
  );

  return result.rows[0] || null;
}

async function updateOnboardingItemStatus({ itemId, status, actorUserId, actorUserRefId }) {
  const actorId = actorUserId || actorUserRefId;
  const setComplete = status === 'done';
  const result = await query(
    `
      UPDATE hr_onboarding_items
      SET
        status = $2,
        completed_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
        completed_by_user_id = CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        application_id,
        committee_id,
        assignee_user_id,
        assignee_user_id AS assignee_user_ref_id,
        template_key,
        title,
        sort_order,
        status,
        completed_at,
        completed_by_user_id,
        completed_by_user_id AS completed_by_user_ref_id,
        created_by_user_id,
        created_at,
        updated_at
    `,
    [itemId, status, setComplete, actorId]
  );

  return result.rows[0] || null;
}

module.exports = {
  createChecklistItems,
  getOnboardingItemById,
  listOnboardingItemsByAssignee,
  updateOnboardingItemStatus,
};
