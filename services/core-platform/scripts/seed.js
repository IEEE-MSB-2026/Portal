const { randomUUID } = require('crypto');
const path = require('path');
const { getPool, closePool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrations');
const logger = require('../src/utils/logger');

async function upsertUser(client, externalUserId, email) {
  const id = randomUUID();
  const result = await client.query(
    `
      INSERT INTO users_ref (id, external_user_id, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (external_user_id)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `,
    [id, externalUserId, email]
  );
  return result.rows[0].id;
}

async function upsertCommittee(client, slug, name) {
  const id = randomUUID();
  const result = await client.query(
    `
      INSERT INTO committees (id, slug, name, is_active)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (slug)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `,
    [id, slug, name]
  );
  return result.rows[0].id;
}

async function ensureMembership(client, committeeId, userRefId, role) {
  await client.query(
    `
      INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (committee_id, user_ref_id)
      DO UPDATE SET role_in_committee = EXCLUDED.role_in_committee
    `,
    [randomUUID(), committeeId, userRefId, role]
  );
}

async function seedTask(client, committeeId, assigneeUserRefId, createdByUserRefId) {
  await client.query(
    `
      INSERT INTO tasks (
        id,
        committee_id,
        title,
        description,
        assignee_user_ref_id,
        created_by_user_ref_id,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'todo')
      ON CONFLICT (id) DO NOTHING
    `,
    [
      randomUUID(),
      committeeId,
      'Prepare weekly committee report',
      'Collect highlights and blockers before Friday.',
      assigneeUserRefId,
      createdByUserRefId,
    ]
  );
}

async function main() {
  const pool = getPool();
  const migrationsDir = path.join(__dirname, '../migrations');
  await runMigrations({ pool, migrationsDir, logger });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminUser = await upsertUser(client, 'admin-1', 'admin@ieee-menofia.local');
    const leadAiUser = await upsertUser(client, 'lead-ai-1', 'lead.ai@ieee-menofia.local');
    const memberAiUser = await upsertUser(client, 'member-ai-1', 'member.ai@ieee-menofia.local');
    const memberWebUser = await upsertUser(client, 'member-web-1', 'member.web@ieee-menofia.local');

    const aiCommittee = await upsertCommittee(client, 'ai', 'AI Committee');
    const webCommittee = await upsertCommittee(client, 'web', 'Web Committee');

    await ensureMembership(client, aiCommittee, leadAiUser, 'lead');
    await ensureMembership(client, aiCommittee, memberAiUser, 'member');
    await ensureMembership(client, webCommittee, memberWebUser, 'member');

    await seedTask(client, aiCommittee, memberAiUser, leadAiUser);

    await client.query('COMMIT');
    logger.info({
      adminUser,
      leadAiUser,
      memberAiUser,
      memberWebUser,
      aiCommittee,
      webCommittee,
    }, 'Seed complete');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
