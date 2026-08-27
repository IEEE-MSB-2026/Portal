const path = require('path');
const { randomUUID } = require('crypto');

function setupTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.CORE_USE_PGMEM = 'false';
  process.env.PORT = '5070';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/ieee_core';
  process.env.CORE_GATEWAY_SHARED_SECRET = 'test-shared-secret';
  delete process.env.IAM_SERVICE_URL;
  delete process.env.IAM_SERVICE_AUTH_TOKEN;
  delete process.env.EMAIL_SERVICE_URL;
  delete process.env.EMAIL_SERVICE_AUTH_TOKEN;
  delete process.env.MEDIA_COMMITTEE_ID;
}

setupTestEnv();

const { getPool, query, closePool } = require('../../src/db/pool');
const { runMigrations } = require('../../src/db/migrations');
const { buildGatewaySignedHeaders } = require('../../src/auth/gatewayContract');

const IDS = {
  committees: {
    ai: '11111111-1111-4111-8111-111111111111',
    web: '22222222-2222-4222-8222-222222222222',
    hr: '32323232-3232-4323-8323-323232323232',
  },
  users: {
    admin: '11111111-0000-4000-8000-000000000001',
    officer: '11111111-0000-4000-8000-000000000002',
    leadAi: '11111111-0000-4000-8000-000000000003',
    memberAi: '11111111-0000-4000-8000-000000000009',
    memberWeb: '11111111-0000-4000-8000-000000000012',
  },
  usersRef: {
    admin: '11111111-0000-4000-8000-000000000001',
    officer: '11111111-0000-4000-8000-000000000002',
    leadAi: '11111111-0000-4000-8000-000000000003',
    memberAi: '11111111-0000-4000-8000-000000000009',
    memberWeb: '11111111-0000-4000-8000-000000000012',
  },
  tasks: {
    aiMemberTodo: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    aiLeadTodo: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    webMemberTodo: '12121212-1212-4121-8121-121212121212',
  },
  resources: {
    aiGuide: '34343434-3434-4343-8343-343434343434',
    webGuide: '45454545-4545-4454-8454-454545454545',
  },
  announcements: {
    aiWeekly: '56565656-5656-4565-8565-565656565656',
    webWeekly: '67676767-6767-4676-8676-676767676767',
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
  await query('DELETE FROM branch_officers');
  await query('DELETE FROM file_assets');
  await query('DELETE FROM media_coverage_activity_log');
  await query('DELETE FROM media_coverage_requests');
  await query('DELETE FROM media_album_assets');
  await query('DELETE FROM media_albums');
  await query('DELETE FROM pr_campaign_dispatch_log');
  await query('DELETE FROM pr_campaigns');
  await query('DELETE FROM pr_announcement_activity_log');
  await query('DELETE FROM pr_announcements');
  await query('DELETE FROM hr_onboarding_items');
  await query('DELETE FROM hr_application_stage_log');
  await query('DELETE FROM hr_applications');
  await query('DELETE FROM hr_campaigns');
  await query('DELETE FROM committee_resources');
  await query('DELETE FROM task_activities');
  await query('DELETE FROM tasks');
  await query('DELETE FROM password_reset_otps');
  await query('DELETE FROM auth_refresh_tokens');
  await query('DELETE FROM auth_user_roles');
  await query('DELETE FROM committee_memberships');
  await query('DELETE FROM committees');
  await query('DELETE FROM users');
}

async function seedBaseData() {
  const pwdHash = '48b529d756e26809a43e6d9885e1c2e7:9f91ed2edf9e031e77311242b9bce3ab0baec08decc7a6b1b708c78f110cbfe33d1f13e61331e23fcefa3cb48ab93ce15736d37c8107b46e1555c1ccf2b5f683';
  await query(
    `
      INSERT INTO users (id, email, password_hash, name, default_role, default_scope_type, default_scope_id)
      VALUES
        ($1, 'admin@ieee.local', $6, 'Admin User', 'admin', 'global', 'global'),
        ($2, 'officer@ieee.local', $6, 'Officer User', 'officer', 'global', 'global'),
        ($3, 'lead.ai@ieee.local', $6, 'Lead AI User', 'lead', 'committee', $7),
        ($4, 'member.ai@ieee.local', $6, 'Member AI User', 'member', 'committee', $7),
        ($5, 'member.web@ieee.local', $6, 'Member Web User', 'member', 'committee', $8)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.users.admin,
      IDS.users.officer,
      IDS.users.leadAi,
      IDS.users.memberAi,
      IDS.users.memberWeb,
      pwdHash,
      IDS.committees.ai,
      IDS.committees.web,
    ]
  );

  await query(
    `
      INSERT INTO committees (id, slug, name, is_active)
      VALUES
        ($1, 'ai', 'AI Committee', TRUE),
        ($2, 'web', 'Web Committee', TRUE),
        ($3, 'hr', 'HR Committee', TRUE)
      ON CONFLICT (id) DO NOTHING
    `,
    [IDS.committees.ai, IDS.committees.web, IDS.committees.hr]
  );

  await query(
    `
      INSERT INTO committee_memberships (id, committee_id, user_id, role_in_committee)
      VALUES
        ($1, $5, $8, 'lead'),
        ($2, $5, $9, 'member'),
        ($3, $6, $10, 'member'),
        ($4, $7, $8, 'lead')
      ON CONFLICT (committee_id, user_id) DO NOTHING
    `,
    [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      IDS.committees.ai,
      IDS.committees.web,
      IDS.committees.hr,
      IDS.users.leadAi,
      IDS.users.memberAi,
      IDS.users.memberWeb,
    ]
  );

  await query(
    `
      INSERT INTO tasks (id, committee_id, title, description, assignee_user_id, created_by_user_id, status)
      VALUES
        ($1, $4, 'AI Task - Member', 'Assigned to AI member', $5, $6, 'todo'),
        ($2, $4, 'AI Task - Lead', 'Assigned to AI lead', $6, $6, 'todo'),
        ($3, $7, 'Web Task - Member', 'Assigned to Web member', $8, $6, 'todo')
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.tasks.aiMemberTodo,
      IDS.tasks.aiLeadTodo,
      IDS.tasks.webMemberTodo,
      IDS.committees.ai,
      IDS.users.memberAi,
      IDS.users.leadAi,
      IDS.committees.web,
      IDS.users.memberWeb,
    ]
  );

  await query(
    `
      INSERT INTO committee_resources (id, committee_id, title, url, description, created_by_user_id)
      VALUES
        ($1, $3, 'AI Onboarding Guide', 'https://docs.example.com/ai/onboarding', 'Internal AI onboarding references', $5),
        ($2, $4, 'Web Handbook', 'https://docs.example.com/web/handbook', 'Web committee handbook', $6)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.resources.aiGuide,
      IDS.resources.webGuide,
      IDS.committees.ai,
      IDS.committees.web,
      IDS.users.leadAi,
      IDS.users.memberWeb,
    ]
  );

  await query(
    `
      INSERT INTO branch_officers (id, name, role, season, is_current_season, avatar_url, linkedin_url, email, bio, display_order, is_active) VALUES
        ('d1111111-1111-4111-8111-111111111111', 'Yousef Abdelwahed', 'Branch Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/yousef-abdelwahed', 'chair@ieee.menoufia.org', 'Leading IEEE MSB into a new era of engineering excellence, innovation, and digital transformation.', 1, TRUE),
        ('d2222222-2222-4222-8222-222222222222', 'Ahmed Mansour', 'Vice Chair', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/ahmed-mansour', 'vicechair@ieee.menoufia.org', 'Overseeing chapter technical committees and student project incubators.', 2, TRUE),
        ('d3333333-3333-4333-8333-333333333333', 'Salma Ezzat', 'General Secretary', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/salma-ezzat', 'secretary@ieee.menoufia.org', 'Managing branch operations, communications, and official documentation.', 3, TRUE),
        ('d4444444-4444-4444-8444-444444444444', 'Omar Farouk', 'Treasurer', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/omar-farouk', 'treasurer@ieee.menoufia.org', 'Managing financial budgets, sponsorships, and resource allocations.', 4, TRUE),
        ('d5555555-5555-4555-8555-555555555555', 'Nourhan Ali', 'Head of Human Resources', '2025/2026', TRUE, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/nourhan-ali', 'hr@ieee.menoufia.org', 'Driving talent recruitment, onboarding, and community culture.', 5, TRUE),
        ('d6666666-6666-4666-8666-111111111111', 'Khaled Ibrahim', 'Past Branch Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/khaled-ibrahim', 'pastchair2024@ieee.menoufia.org', 'Chair of the 2024/2025 Executive Committee.', 1, TRUE),
        ('d7777777-7777-4777-8777-111111111111', 'Mariam Tarek', 'Past Vice Chair', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/mariam-tarek', 'pastvice2024@ieee.menoufia.org', 'Vice Chair of the 2024/2025 Executive Committee.', 2, TRUE),
        ('d8888888-8888-4888-8888-111111111111', 'Mostafa Kamal', 'Past Secretary', '2024/2025', FALSE, 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80', 'https://linkedin.com/in/mostafa-kamal', 'pastsec2024@ieee.menoufia.org', 'Secretary of the 2024/2025 Executive Committee.', 3, TRUE)
      ON CONFLICT (id) DO NOTHING
    `
  );

  await query(
    `
      INSERT INTO auth_user_roles (id, user_id, role, scope_type, scope_id, committee_id, is_active)
      VALUES
        ('c1111111-1111-4111-8111-111111111111', $1::uuid, 'admin', 'global', 'global', NULL, TRUE),
        ('c2222222-2222-4222-8222-111111111111', $2::uuid, 'officer', 'global', 'global', NULL, TRUE),
        ('c3333333-3333-4333-8333-111111111111', $3::uuid, 'lead', 'committee', $5::text, $5::uuid, TRUE),
        ('c3333333-3333-4333-8333-323232323232', $3::uuid, 'member', 'committee', $7::text, $7::uuid, TRUE),
        ('c9999999-9999-4999-8999-111111111111', $4::uuid, 'member', 'committee', $5::text, $5::uuid, TRUE),
        ('c9999999-9999-4999-8999-222222222222', $4::uuid, 'member', 'committee', $6::text, $6::uuid, TRUE),
        ('c1212121-1212-4121-8121-121212121212', $8::uuid, 'member', 'committee', $6::text, $6::uuid, TRUE)
      ON CONFLICT (user_id, role, scope_type, scope_id) DO UPDATE SET is_active = TRUE;
    `,
    [
      IDS.users.admin,
      IDS.users.officer,
      IDS.users.leadAi,
      IDS.users.memberAi,
      IDS.committees.ai,
      IDS.committees.web,
      IDS.committees.hr,
      IDS.users.memberWeb,
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
  getPool,
  prepareDatabase,
  query,
  resetDatabase,
  seedBaseData,
  setupTestEnv,
  signedHeaders,
};
