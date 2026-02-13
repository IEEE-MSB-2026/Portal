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

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('committee isolation: member of AI cannot read WEB workspace', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/committees/${IDS.committees.web}/workspace`;
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

    assert.equal(response.status, 403);
    assert.equal(payload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('workspace read: unknown committee returns 404 for global admin', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const unknownCommitteeId = '33333333-3333-4333-8333-333333333333';
    const path = `/core/committees/${unknownCommitteeId}/workspace`;
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: 'admin-1',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, { headers });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error, 'Committee not found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
