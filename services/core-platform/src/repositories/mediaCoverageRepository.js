const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

function mapCoverageColumns(prefix = 'r') {
  return `
    ${prefix}.id,
    ${prefix}.committee_id,
    ${prefix}.media_committee_id,
    ${prefix}.title,
    ${prefix}.description,
    ${prefix}.event_at,
    ${prefix}.status,
    ${prefix}.requested_by_user_id,
    ${prefix}.requested_by_user_id AS requested_by_user_ref_id,
    ${prefix}.accepted_by_user_id,
    ${prefix}.accepted_by_user_id AS accepted_by_user_ref_id,
    ${prefix}.linked_task_id,
    ${prefix}.created_at,
    ${prefix}.updated_at
  `;
}

function mapCoverageSelect(prefix = 'r') {
  return `
    ${mapCoverageColumns(prefix)},
    origin.name AS committee_name,
    media.name AS media_committee_name,
    requester.id AS requested_by_external_user_id,
    requester.name AS requester_name,
    accepter.id AS accepted_by_external_user_id,
    accepter.name AS accepter_name
  `;
}

async function getCoverageRequestById(requestId) {
  const result = await query(
    `
      SELECT
        ${mapCoverageSelect('r')}
      FROM media_coverage_requests r
      JOIN committees origin ON origin.id = r.committee_id
      JOIN committees media ON media.id = r.media_committee_id
      JOIN users requester ON requester.id = r.requested_by_user_id
      LEFT JOIN users accepter ON accepter.id = r.accepted_by_user_id
      WHERE r.id = $1
      LIMIT 1
    `,
    [requestId]
  );
  return result.rows[0] || null;
}

async function createCoverageRequest({
  committeeId,
  mediaCommitteeId,
  title,
  description,
  eventAt,
  requestedByUserId,
  requestedByUserRefId,
}) {
  const requestId = randomUUID();
  const requesterId = requestedByUserId || requestedByUserRefId;
  const targetDate = eventAt ? new Date(eventAt) : new Date();

  await query(
    `
      INSERT INTO media_coverage_requests (
        id,
        committee_id,
        media_committee_id,
        title,
        description,
        event_at,
        status,
        requested_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7)
    `,
    [requestId, committeeId, mediaCommitteeId, title.trim(), description ? description.trim() : null, targetDate, requesterId]
  );

  return getCoverageRequestById(requestId);
}

async function updateCoverageStatus({
  requestId,
  status,
  actorUserId,
  actorUserRefId,
  linkedTaskId = null,
}) {
  const actorId = actorUserId || actorUserRefId;
  const result = await query(
    `
      UPDATE media_coverage_requests
      SET
        status = $2::media_coverage_status_type,
        accepted_by_user_id = CASE
          WHEN $2::text = 'accepted' THEN $3::uuid
          ELSE accepted_by_user_id
        END,
        linked_task_id = CASE
          WHEN $2::text = 'accepted' THEN COALESCE(linked_task_id, $4::uuid)
          ELSE linked_task_id
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [requestId, status, actorId, linkedTaskId]
  );

  if (!result.rows[0]) return null;
  return getCoverageRequestById(requestId);
}

async function createCoverageActivity({
  coverageRequestId,
  action,
  actorUserId,
  actorUserRefId,
  fromStatus,
  toStatus,
  notes,
}) {
  const actorId = actorUserId || actorUserRefId;
  await query(
    `
      INSERT INTO media_coverage_activity_log (
        id,
        coverage_request_id,
        action,
        actor_user_id,
        from_status,
        to_status,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      randomUUID(),
      coverageRequestId,
      action,
      actorId,
      fromStatus || null,
      toStatus || null,
      notes || null,
    ]
  );
  return true;
}

module.exports = {
  createCoverageActivity,
  createCoverageRequest,
  getCoverageRequestById,
  updateCoverageStatus,
};
