const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  prepareDatabase,
  signedHeaders,
  setupTestEnv,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('gateway auth: missing headers returns 401', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/core/me/dashboard`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized gateway request');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('gateway auth: invalid signature returns 401', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const headers = signedHeaders({
      method: 'GET',
      path: '/core/me/dashboard',
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
    });
    headers['x-gateway-signature'] = `${headers['x-gateway-signature']}tampered`;

    const response = await fetch(`${getBaseUrl(server)}/core/me/dashboard`, { headers });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized gateway request');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('gateway auth: expired timestamp returns 401', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 120;
    const headers = signedHeaders({
      method: 'GET',
      path: '/core/me/dashboard',
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
      timestamp: oldTimestamp,
    });

    const response = await fetch(`${getBaseUrl(server)}/core/me/dashboard`, { headers });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized gateway request');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('gateway auth: role aliases organizer/scanner/content_editor are accepted', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = '/core/me/dashboard';
    const organizerHeaders = signedHeaders({
      method: 'GET',
      path,
      userId: 'organizer-1',
      userEmail: 'organizer@ieee.local',
      userRole: 'organizer',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
    });
    const scannerHeaders = signedHeaders({
      method: 'GET',
      path,
      userId: 'scanner-1',
      userEmail: 'scanner@ieee.local',
      userRole: 'scanner',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
    });
    const editorHeaders = signedHeaders({
      method: 'GET',
      path,
      userId: 'editor-1',
      userEmail: 'editor@ieee.local',
      userRole: 'content_editor',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
    });

    const organizerRes = await fetch(`${getBaseUrl(server)}${path}`, { headers: organizerHeaders });
    const scannerRes = await fetch(`${getBaseUrl(server)}${path}`, { headers: scannerHeaders });
    const editorRes = await fetch(`${getBaseUrl(server)}${path}`, { headers: editorHeaders });

    assert.equal(organizerRes.status, 200);
    assert.equal(scannerRes.status, 200);
    assert.equal(editorRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('gateway auth: officer role is accepted for global scope', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = '/core/routes';
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, { headers });
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
