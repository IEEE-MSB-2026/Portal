const { query } = require('../db/pool');

const SUMMARY_STAGE_COLUMNS = new Set([
  'applied',
  'screening',
  'interview',
  'final_review',
  'accepted',
  'rejected',
]);

function emptyStageCounts() {
  return {
    applied: 0,
    screening: 0,
    interview: 0,
    final_review: 0,
    accepted: 0,
    rejected: 0,
  };
}

function buildScopeWhere({ committeeId, campaignId }) {
  const values = [];
  const where = [];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  }

  if (campaignId) {
    values.push(campaignId);
    where.push(`a.campaign_id = $${values.length}`);
  }

  return {
    values,
    whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
  };
}

async function getPipelineSummary({ committeeId = null, campaignId = null }) {
  const { values, whereClause } = buildScopeWhere({ committeeId, campaignId });

  const result = await query(
    `
      SELECT
        a.current_stage,
        COUNT(*)::int AS total
      FROM hr_applications a
      JOIN hr_campaigns c ON c.id = a.campaign_id
      ${whereClause}
      GROUP BY a.current_stage
    `,
    values
  );

  const stages = emptyStageCounts();
  let total = 0;

  for (const row of result.rows) {
    const stage = row.current_stage;
    const count = Number(row.total) || 0;
    total += count;
    if (SUMMARY_STAGE_COLUMNS.has(stage)) {
      stages[stage] += count;
    }
  }

  return { total, stages };
}

function getUtcBucketStart(date, granularity) {
  const d = new Date(date);
  if (granularity === 'day') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  const day = d.getUTCDay(); // 0=Sunday, 1=Monday
  const offsetFromMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offsetFromMonday));
  return monday.toISOString();
}

async function getPipelineTimeline({
  committeeId = null,
  campaignId = null,
  from,
  to,
  granularity,
}) {
  const values = [from.toISOString(), to.toISOString()];
  const where = ['l.created_at >= $1', 'l.created_at < $2'];

  if (committeeId) {
    values.push(committeeId);
    where.push(`c.committee_id = $${values.length}`);
  }
  if (campaignId) {
    values.push(campaignId);
    where.push(`a.campaign_id = $${values.length}`);
  }

  const result = await query(
    `
      SELECT
        l.created_at,
        l.to_stage
      FROM hr_application_stage_log l
      JOIN hr_applications a ON a.id = l.application_id
      JOIN hr_campaigns c ON c.id = a.campaign_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.created_at ASC
    `,
    values
  );

  const byBucket = new Map();
  for (const row of result.rows) {
    const bucket = getUtcBucketStart(row.created_at, granularity);
    if (!byBucket.has(bucket)) {
      byBucket.set(bucket, {
        bucketStart: bucket,
        totalTransitions: 0,
        toStages: emptyStageCounts(),
      });
    }

    const point = byBucket.get(bucket);
    point.totalTransitions += 1;
    if (SUMMARY_STAGE_COLUMNS.has(row.to_stage)) {
      point.toStages[row.to_stage] += 1;
    }
  }

  return Array.from(byBucket.values());
}

module.exports = {
  getPipelineSummary,
  getPipelineTimeline,
};
