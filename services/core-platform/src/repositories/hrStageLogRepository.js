const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createStageLog({ applicationId, fromStage, toStage, score, notes, actorUserId, actorUserRefId }) {
  const id = randomUUID();
  const actorId = actorUserId || actorUserRefId;
  const result = await query(
    `
      INSERT INTO hr_application_stage_log (
        id,
        application_id,
        from_stage,
        to_stage,
        score,
        notes,
        actor_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        application_id,
        from_stage,
        to_stage,
        score,
        notes,
        actor_user_id,
        actor_user_id AS actor_user_ref_id,
        created_at
    `,
    [id, applicationId, fromStage || null, toStage, score ?? null, notes || null, actorId]
  );

  return result.rows[0];
}

module.exports = {
  createStageLog,
};
