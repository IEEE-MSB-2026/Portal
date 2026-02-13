const path = require('path');
const { randomUUID } = require('crypto');

function setupTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.CORE_USE_PGMEM = 'true';
  process.env.PORT = process.env.PORT || '5070';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused/unused';
  process.env.CORE_GATEWAY_SHARED_SECRET = process.env.CORE_GATEWAY_SHARED_SECRET || 'test-shared-secret';
}

setupTestEnv();

const { getPool, query, closePool } = require('../../src/db/pool');
const { runMigrations } = require('../../src/db/migrations');
const { buildGatewaySignedHeaders } = require('../../src/auth/gatewayContract');

const IDS = {
  committees: {
    ai: '11111111-1111-4111-8111-111111111111',
    web: '22222222-2222-4222-8222-222222222222',
  },
  usersRef: {
    admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leadAi: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    memberAi: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    memberWeb: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  },
  tasks: {
    aiMemberTodo: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    aiLeadTodo: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    webMemberTodo: '12121212-1212-4121-8121-121212121212',
  },
};

let bootstrapPromise;

async function bootstrapTestDatabase() {
  if (!bootstrapPromise) {
    bootstrapPromise = runMigrations({
      pool: getPool(),
      migrationsDir: path.join(__dirname, '../../migrations'),
      logger: { info: () => {}, error: () => {} },
    });
  }

  await bootstrapPromise;
}

async function resetDatabase() {
  await query('DELETE FROM task_activity_log');
  await query('DELETE FROM tasks');
  await query('DELETE FROM committee_memberships');
  await query('DELETE FROM committees');
  await query('DELETE FROM users_ref');
}

async function seedBaseData() {
  await query(
    `
      INSERT INTO users_ref (id, external_user_id, email)
      VALUES
        ($1, 'admin-1', 'admin@ieee.local'),
        ($2, 'lead-ai-1', 'lead.ai@ieee.local'),
        ($3, 'member-ai-1', 'member.ai@ieee.local'),
        ($4, 'member-web-1', 'member.web@ieee.local')
    `,
    [IDS.usersRef.admin, IDS.usersRef.leadAi, IDS.usersRef.memberAi, IDS.usersRef.memberWeb]
  );

  await query(
    `
      INSERT INTO committees (id, slug, name, is_active)
      VALUES
        ($1, 'ai', 'AI Committee', TRUE),
        ($2, 'web', 'Web Committee', TRUE)
    `,
    [IDS.committees.ai, IDS.committees.web]
  );

  await query(
    `
      INSERT INTO committee_memberships (id, committee_id, user_ref_id, role_in_committee)
      VALUES
        ($1, $3, $5, 'lead'),
        ($2, $3, $6, 'member'),
        ($4, $7, $8, 'member')
    `,
    [
      randomUUID(),
      randomUUID(),
      IDS.committees.ai,
      randomUUID(),
      IDS.usersRef.leadAi,
      IDS.usersRef.memberAi,
      IDS.committees.web,
      IDS.usersRef.memberWeb,
    ]
  );

  await query(
    `
      INSERT INTO tasks (id, committee_id, title, description, assignee_user_ref_id, created_by_user_ref_id, status)
      VALUES
        ($1, $4, 'AI Task - Member', 'Assigned to AI member', $5, $6, 'todo'),
        ($2, $4, 'AI Task - Lead', 'Assigned to AI lead', $6, $6, 'todo'),
        ($3, $7, 'Web Task - Member', 'Assigned to Web member', $8, $6, 'todo')
    `,
    [
      IDS.tasks.aiMemberTodo,
      IDS.tasks.aiLeadTodo,
      IDS.tasks.webMemberTodo,
      IDS.committees.ai,
      IDS.usersRef.memberAi,
      IDS.usersRef.leadAi,
      IDS.committees.web,
      IDS.usersRef.memberWeb,
    ]
  );
}

async function prepareDatabase() {
  await bootstrapTestDatabase();
  await resetDatabase();
  await seedBaseData();
}

function signedHeaders({ method, path, userId, userEmail, userRole, scopeType, scopeId, timestamp }) {
  return buildGatewaySignedHeaders({
    method,
    path,
    userId,
    userEmail,
    userRole,
    scopeType,
    scopeId,
    timestamp,
    secret: process.env.CORE_GATEWAY_SHARED_SECRET,
  });
}

function createServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getBaseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

module.exports = {
  IDS,
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  prepareDatabase,
  query,
  setupTestEnv,
  signedHeaders,
};
