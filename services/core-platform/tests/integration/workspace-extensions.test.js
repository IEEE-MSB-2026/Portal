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

test('resources: member can list own committee resources only', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/committees/${IDS.committees.ai}/resources`;
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
    assert.equal(payload.resources.length, 1);
    assert.equal(payload.resources[0].committeeId, IDS.committees.ai);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('resources: lead can create resource, member cannot create', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/committees/${IDS.committees.ai}/resources`;

    const leadHeaders = signedHeaders({
      method: 'POST',
      path,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const createRes = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'POST',
      headers: {
        ...leadHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'AI Session Repository',
        url: 'https://example.com/ai/sessions',
        description: 'Session notes and code',
      }),
    });

    const createPayload = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createPayload.resource.title, 'AI Session Repository');

    const memberHeaders = signedHeaders({
      method: 'POST',
      path,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const forbiddenRes = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'POST',
      headers: {
        ...memberHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Forbidden',
        url: 'https://example.com/forbidden',
      }),
    });

    const forbiddenPayload = await forbiddenRes.json();
    assert.equal(forbiddenRes.status, 403);
    assert.equal(forbiddenPayload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('announcements: lead can create, member can list, cross-committee forbidden', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createPath = `/core/committees/${IDS.committees.ai}/announcements`;
    const leadHeaders = signedHeaders({
      method: 'POST',
      path: createPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const createRes = await fetch(`${getBaseUrl(server)}${createPath}`, {
      method: 'POST',
      headers: {
        ...leadHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'AI Hackathon Prep',
        body: 'Prepare demo topics before Friday.',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1234/ieee_portal/announcements/hackathon.jpg',
      }),
    });

    const createPayload = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createPayload.announcement.imageUrl, 'https://res.cloudinary.com/demo/image/upload/v1234/ieee_portal/announcements/hackathon.jpg');

    const listPath = `/core/committees/${IDS.committees.ai}/announcements`;
    const memberHeaders = signedHeaders({
      method: 'GET',
      path: listPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const listRes = await fetch(`${getBaseUrl(server)}${listPath}`, { headers: memberHeaders });
    const listPayload = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.equal(listPayload.announcements.length >= 2, true);
    const foundAnnouncement = listPayload.announcements.find((a) => a.title === 'AI Hackathon Prep');
    assert.ok(foundAnnouncement);
    assert.equal(foundAnnouncement.imageUrl, 'https://res.cloudinary.com/demo/image/upload/v1234/ieee_portal/announcements/hackathon.jpg');

    const crossPath = `/core/committees/${IDS.committees.web}/announcements`;
    const crossHeaders = signedHeaders({
      method: 'GET',
      path: crossPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const crossRes = await fetch(`${getBaseUrl(server)}${crossPath}`, { headers: crossHeaders });
    const crossPayload = await crossRes.json();

    assert.equal(crossRes.status, 403);
    assert.equal(crossPayload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('memberships: lead can add member; member cannot manage; lead cannot remove last lead', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const upsertPath = `/core/committees/${IDS.committees.ai}/memberships`;
    const leadHeaders = signedHeaders({
      method: 'POST',
      path: upsertPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const addRes = await fetch(`${getBaseUrl(server)}${upsertPath}`, {
      method: 'POST',
      headers: {
        ...leadHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalUserId: 'new-ai-member-1',
        email: 'new.ai.member@ieee.local',
        roleInCommittee: 'member',
      }),
    });

    const addPayload = await addRes.json();
    assert.equal(addRes.status, 201);
    assert.equal(addPayload.membership.externalUserId, 'new-ai-member-1');

    const memberHeaders = signedHeaders({
      method: 'POST',
      path: upsertPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const forbiddenRes = await fetch(`${getBaseUrl(server)}${upsertPath}`, {
      method: 'POST',
      headers: {
        ...memberHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalUserId: 'x',
        email: 'x@ieee.local',
        roleInCommittee: 'member',
      }),
    });

    assert.equal(forbiddenRes.status, 403);

    const removeLeadPath = `/core/committees/${IDS.committees.ai}/memberships/lead-ai-1`;
    const removeHeaders = signedHeaders({
      method: 'DELETE',
      path: removeLeadPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const removeRes = await fetch(`${getBaseUrl(server)}${removeLeadPath}`, {
      method: 'DELETE',
      headers: removeHeaders,
    });
    const removePayload = await removeRes.json();

    assert.equal(removeRes.status, 403);
    assert.equal(removePayload.error, 'Only admin can remove committee lead');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
