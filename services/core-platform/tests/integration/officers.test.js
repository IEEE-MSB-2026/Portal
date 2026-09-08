const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  setupTestEnv,
  signedHeaders,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

async function requestJson(server, { method, path, headers, body }) {
  const response = await fetch(`${getBaseUrl(server)}${path}`, {
    method,
    headers: body === undefined
      ? headers
      : {
          ...(headers || {}),
          'content-type': 'application/json',
        },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: payload,
  };
}

test('Branch Officers & Leadership Integration Tests', async (t) => {
  let server;
  let createdOfficerId;

  t.before(async () => {
    await bootstrapTestDatabase();
    server = await createServer(app);
  });

  t.after(async () => {
    if (server) await server.close();
    await closePool();
  });

  await t.test('GET /public/officers returns current season officers by default', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/public/officers',
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.officers));
    assert.equal(res.body.season, '2025/2026');
    assert.ok(res.body.officers.length >= 5);
    assert.ok(res.body.officers.some((o) => o.name === 'Yousef Abdelwahed' && o.role === 'Branch Chair'));
  });

  await t.test('GET /public/officers?season=2024/2025 filters by season query param', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/public/officers?season=2024/2025',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.season, '2024/2025');
    assert.equal(res.body.officers.length, 3);
    assert.ok(res.body.officers.every((o) => o.season === '2024/2025'));
  });

  await t.test('GET /public/officers/seasons lists distinct seasons with current indicator', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/public/officers/seasons',
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.seasons));
    const current = res.body.seasons.find((s) => s.season === '2025/2026');
    assert.ok(current);
    assert.equal(current.isCurrent, true);
  });

  await t.test('POST /core/admin/officers creates a new officer with valid season format', async () => {
    const headers = signedHeaders({
      method: 'POST',
      path: '/core/admin/officers',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const { query } = require('../../src/db/pool');
    const res = await requestJson(server, {
      method: 'POST',
      path: '/core/admin/officers',
      headers,
      body: {
        name: 'Future Leader',
        role: 'Strategic Advisor',
        season: '2026/2027',
        avatarUrl: 'https://res.cloudinary.com/demo/image/upload/v1/officer-lead.jpg',
        isCurrentSeason: false,
        email: 'future@ieee-menoufia.org',
        linkedinUrl: 'https://linkedin.com',
        bio: 'Advising future seasons',
        displayOrder: 99,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.officer.name, 'Future Leader');
    assert.equal(res.body.officer.season, '2026/2027');
    assert.equal(res.body.officer.avatar_url || res.body.officer.avatarUrl, 'https://res.cloudinary.com/demo/image/upload/v1/officer-lead.jpg');
    createdOfficerId = res.body.officer.id;
  });

  await t.test('POST /core/admin/officers rejects invalid season format', async () => {
    const headers = signedHeaders({
      method: 'POST',
      path: '/core/admin/officers',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const res = await requestJson(server, {
      method: 'POST',
      path: '/core/admin/officers',
      headers,
      body: {
        name: 'Invalid Season Test',
        role: 'Member',
        season: '2025-2026', // invalid, must be YYYY/YYYY
      },
    });

    assert.equal(res.status, 400);
  });

  await t.test('PATCH /core/admin/officers/:id updates officer details and queues old avatar for deletion', async () => {
    const { query } = require('../../src/db/pool');
    const headers = signedHeaders({
      method: 'PATCH',
      path: `/core/admin/officers/${createdOfficerId}`,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const res = await requestJson(server, {
      method: 'PATCH',
      path: `/core/admin/officers/${createdOfficerId}`,
      headers,
      body: {
        role: 'Senior Strategic Advisor',
        avatarUrl: 'https://res.cloudinary.com/demo/image/upload/v2/officer-lead-updated.jpg',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.officer.role, 'Senior Strategic Advisor');
    assert.equal(res.body.officer.avatar_url || res.body.officer.avatarUrl, 'https://res.cloudinary.com/demo/image/upload/v2/officer-lead-updated.jpg');

    // Verify old avatar was queued into file_assets with status 'pending_deletion'
    const queueCheck = await query(
      "SELECT status, secure_url FROM file_assets WHERE secure_url = $1",
      ['https://res.cloudinary.com/demo/image/upload/v1/officer-lead.jpg']
    );
    assert.equal(queueCheck.rows.length, 1);
    assert.equal(queueCheck.rows[0].status, 'pending_deletion');
  });

  await t.test('DELETE /core/admin/officers/:id removes officer and queues avatar for deletion', async () => {
    const { query } = require('../../src/db/pool');
    const headers = signedHeaders({
      method: 'DELETE',
      path: `/core/admin/officers/${createdOfficerId}`,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const res = await requestJson(server, {
      method: 'DELETE',
      path: `/core/admin/officers/${createdOfficerId}`,
      headers,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdOfficerId);

    // Verify updated avatar was queued into file_assets with status 'pending_deletion'
    const queueCheck = await query(
      "SELECT status, secure_url FROM file_assets WHERE secure_url = $1",
      ['https://res.cloudinary.com/demo/image/upload/v2/officer-lead-updated.jpg']
    );
    assert.equal(queueCheck.rows.length, 1);
    assert.equal(queueCheck.rows[0].status, 'pending_deletion');
  });

  await t.test('PUT /core/admin/officers/seasons/set-active switches active season flag atomically', async () => {
    const { query } = require('../../src/db/pool');
    const headers = signedHeaders({
      method: 'PUT',
      path: '/core/admin/officers/seasons/set-active',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const res = await requestJson(server, {
      method: 'PUT',
      path: '/core/admin/officers/seasons/set-active',
      headers,
      body: { season: '2024/2025' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.season, '2024/2025');

    // Verify 2024/2025 officers are now is_current_season = true
    const checkActive = await query('SELECT count(*)::int as cnt FROM branch_officers WHERE season = $1 AND is_current_season = TRUE', ['2024/2025']);
    assert.ok(checkActive.rows[0].cnt > 0);

    // Switch back to 2025/2026
    await requestJson(server, {
      method: 'PUT',
      path: '/core/admin/officers/seasons/set-active',
      headers,
      body: { season: '2025/2026' },
    });
  });
});
