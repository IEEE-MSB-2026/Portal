const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IDS,
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  prepareDatabase,
  setupTestEnv,
  signedHeaders,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

function materializePath(path) {
  return path
    .replace(':committeeId', IDS.committees.ai)
    .replace(':taskId', IDS.tasks.aiMemberTodo)
    .replace(':campaignId', '78787878-7878-4787-8787-787878787878')
    .replace(':applicationId', '89898989-8989-4898-8898-898989898989')
    .replace(':announcementId', '91919191-9191-4919-8191-919191919191')
    .replace(':albumId', '92929292-9292-4929-8292-929292929292')
    .replace(':requestId', '93939393-9393-4939-8393-939393939393')
    .replace(':itemId', '90909090-9090-4090-8090-909090909090')
    .replace(':userId', 'member-ai-1');
}

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('dashboard: returns only caller committees and assigned tasks', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = '/core/me/dashboard';
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, { headers });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.committees.length, 1);
    assert.equal(payload.committees[0].id, IDS.committees.ai);
    assert.equal(payload.tasks.items.length >= 1, true);
    assert.equal(payload.recentAnnouncements.length >= 1, true);

    for (const task of payload.tasks.items) {
      assert.equal(task.committeeId, IDS.committees.ai);
      assert.equal(task.assigneeUserId, 'member-ai-1');
    }

    for (const announcement of payload.recentAnnouncements) {
      assert.equal(announcement.committeeId, IDS.committees.ai);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('route docs: all listed /core routes are mounted (non-404 contract)', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const catalogPath = '/core/routes';
    const catalogHeaders = signedHeaders({
      method: 'GET',
      path: catalogPath,
      userId: 'admin-1',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const docsResponse = await fetch(`${getBaseUrl(server)}${catalogPath}`, { headers: catalogHeaders });
    const docsPayload = await docsResponse.json();

    assert.equal(docsResponse.status, 200);
    assert.ok(Array.isArray(docsPayload.routes));

    const failures = [];
    for (const route of docsPayload.routes) {
      const resolvedPath = materializePath(route.path);
      const headers = signedHeaders({
        method: 'OPTIONS',
        path: resolvedPath,
        userId: 'admin-1',
        userEmail: 'admin@ieee.local',
        userRole: 'admin',
        scopeType: 'global',
        scopeId: 'global',
      });

      const response = await fetch(`${getBaseUrl(server)}${resolvedPath}`, {
        method: 'OPTIONS',
        headers,
      });

      if (response.status === 404) {
        failures.push({ route: `${route.method} ${route.path}`, resolvedPath });
      }
    }

    assert.deepEqual(failures, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
