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

test('hr follow-up: HR lead can read other committee workspace but cannot create tasks', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    // 1. HR Lead reading AI committee workspace -> 200 OK
    const getPath = `/core/committees/${IDS.committees.ai}/workspace`;
    const getHeaders = signedHeaders({
      method: 'GET',
      path: getPath,
      userId: 'lead-hr-1',
      userEmail: 'lead.hr@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
    });

    const getRes = await fetch(`${getBaseUrl(server)}${getPath}`, { headers: getHeaders });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.committee.id, IDS.committees.ai);

    // 2. HR Lead attempting to create a task in AI committee workspace -> 403 Forbidden
    const postPath = `/core/committees/${IDS.committees.ai}/tasks`;
    const postHeaders = signedHeaders({
      method: 'POST',
      path: postPath,
      userId: 'lead-hr-1',
      userEmail: 'lead.hr@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
    });

    const postRes = await fetch(`${getBaseUrl(server)}${postPath}`, {
      method: 'POST',
      headers: { ...postHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Unauthorized Task',
        priority: 'high',
      }),
    });
    assert.equal(postRes.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr observer: assigned hr observer can read workspace but cannot modify tasks', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    // 1. Admin assigns a user to AI committee with role 'hr'
    const assignPath = `/core/committees/${IDS.committees.ai}/memberships`;
    const assignHeaders = signedHeaders({
      method: 'POST',
      path: assignPath,
      userId: 'admin-1',
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const assignRes = await fetch(`${getBaseUrl(server)}${assignPath}`, {
      method: 'POST',
      headers: { ...assignHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'observer.hr@ieee.local',
        roleInCommittee: 'hr',
      }),
    });
    assert.equal(assignRes.status, 201);
    const assignData = await assignRes.json();
    assert.equal(assignData.membership.roleInCommittee, 'hr');

    // 2. HR observer reads AI committee workspace -> 200 OK
    const getPath = `/core/committees/${IDS.committees.ai}/workspace`;
    const observerHeaders = signedHeaders({
      method: 'GET',
      path: getPath,
      userId: assignData.membership.userRefId,
      userEmail: 'observer.hr@ieee.local',
      userRole: 'hr',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const getRes = await fetch(`${getBaseUrl(server)}${getPath}`, { headers: observerHeaders });
    assert.equal(getRes.status, 200);

    // 3. HR observer attempts to create task -> 403 Forbidden
    const postPath = `/core/committees/${IDS.committees.ai}/tasks`;
    const postHeaders = signedHeaders({
      method: 'POST',
      path: postPath,
      userId: assignData.membership.userRefId,
      userEmail: 'observer.hr@ieee.local',
      userRole: 'hr',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const postRes = await fetch(`${getBaseUrl(server)}${postPath}`, {
      method: 'POST',
      headers: { ...postHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'HR Observer Illegal Task',
      }),
    });
    assert.equal(postRes.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
