const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

async function createStageLog({ applicationId, fromStage, toStage, score, notes, actorUserRefId }) {
  const id = randomUUID();
  const result = await query(
    `
      INSERT INTO hr_application_stage_log (
        id,
        application_id,
        from_stage,
        to_stage,
        score,
        notes,
        actor_user_ref_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        application_id,
        from_stage,
        to_stage,
        score,
        notes,
        actor_user_ref_id,
        created_at
    `,
    [id, applicationId, fromStage || null, toStage, score ?? null, notes || null, actorUserRefId]
  );

  return result.rows[0];
}

module.exports = {
  createStageLog,
};
