const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IDS,
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  prepareDatabase,
  query,
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

  const payload = await response.json();
  return { response, payload };
}

function signedCoreHeaders({ method, path, actor }) {
  return signedHeaders({
    method,
    path,
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
    scopeType: actor.scopeType,
    scopeId: actor.scopeId,
  });
}

const ACTORS = {
  leadAi: {
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.ai,
  },
  memberAi: {
    userId: 'member-ai-1',
    userEmail: 'member.ai@ieee.local',
    userRole: 'member',
    scopeType: 'committee',
    scopeId: IDS.committees.ai,
  },
  publisherGlobal: {
    userId: 'publisher-1',
    userEmail: 'publisher@ieee.local',
    userRole: 'publisher',
    scopeType: 'global',
    scopeId: 'global',
  },
};

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('pr announcements: public listing is unauthenticated and returns only public non-deleted rows', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createPath = '/core/pr/announcements';
    const leadHeaders = signedCoreHeaders({
      method: 'POST',
      path: createPath,
      actor: ACTORS.leadAi,
    });

    const createdInternal = await requestJson(server, {
      method: 'POST',
      path: createPath,
      headers: leadHeaders,
      body: {
        committeeId: IDS.committees.ai,
        title: 'Internal PR Notes',
        body: 'Internal only planning memo.',
        visibility: 'internal',
      },
    });
    assert.equal(createdInternal.response.status, 201);

    const createdPublic = await requestJson(server, {
      method: 'POST',
      path: createPath,
      headers: leadHeaders,
      body: {
        committeeId: IDS.committees.ai,
        title: 'Public Announcement',
        body: 'Public release content.',
        visibility: 'public',
      },
    });
    assert.equal(createdPublic.response.status, 201);

    const publicList = await requestJson(server, {
      method: 'GET',
      path: '/public/pr/announcements',
    });

    assert.equal(publicList.response.status, 200);
    assert.equal(publicList.payload.announcements.length, 1);
    assert.equal(publicList.payload.announcements[0].title, 'Public Announcement');
    assert.equal(publicList.payload.announcements[0].visibility, 'public');

    const createdLogCount = await query(
      `
        SELECT COUNT(*)::int AS c
        FROM pr_announcement_activity_log
        WHERE action = 'created'
      `
    );
    assert.equal(createdLogCount.rows[0].c, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pr announcements: publisher can update and delete with audit log trail', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createPath = '/core/pr/announcements';
    const leadCreateHeaders = signedCoreHeaders({
      method: 'POST',
      path: createPath,
      actor: ACTORS.leadAi,
    });

    const created = await requestJson(server, {
      method: 'POST',
      path: createPath,
      headers: leadCreateHeaders,
      body: {
        committeeId: IDS.committees.ai,
        title: 'Press Briefing',
        body: 'Initial draft',
        visibility: 'public',
      },
    });
    assert.equal(created.response.status, 201);

    const announcementId = created.payload.announcement.id;
    const updatePath = `/core/pr/announcements/${announcementId}`;
    const publisherPatchHeaders = signedCoreHeaders({
      method: 'PATCH',
      path: updatePath,
      actor: ACTORS.publisherGlobal,
    });

    const updated = await requestJson(server, {
      method: 'PATCH',
      path: updatePath,
      headers: publisherPatchHeaders,
      body: {
        title: 'Press Briefing - Final',
        body: 'Final approved content',
      },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.announcement.title, 'Press Briefing - Final');

    const deletePath = `/core/pr/announcements/${announcementId}`;
    const publisherDeleteHeaders = signedCoreHeaders({
      method: 'DELETE',
      path: deletePath,
      actor: ACTORS.publisherGlobal,
    });

    const deleted = await requestJson(server, {
      method: 'DELETE',
      path: deletePath,
      headers: publisherDeleteHeaders,
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(Boolean(deleted.payload.announcement.deletedAt), true);

    const publicList = await requestJson(server, {
      method: 'GET',
      path: '/public/pr/announcements',
    });
    assert.equal(publicList.response.status, 200);
    assert.equal(publicList.payload.announcements.length, 0);

    const actions = await query(
      `
        SELECT action
        FROM pr_announcement_activity_log
        WHERE announcement_id = $1
        ORDER BY created_at ASC
      `,
      [announcementId]
    );
    assert.deepEqual(actions.rows.map((row) => row.action), ['created', 'updated', 'deleted']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pr announcements: member is blocked from protected management routes', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createPath = '/core/pr/announcements';
    const leadCreateHeaders = signedCoreHeaders({
      method: 'POST',
      path: createPath,
      actor: ACTORS.leadAi,
    });

    const created = await requestJson(server, {
      method: 'POST',
      path: createPath,
      headers: leadCreateHeaders,
      body: {
        committeeId: IDS.committees.ai,
        title: 'Leadership Update',
        body: 'Lead-only managed post',
        visibility: 'internal',
      },
    });
    assert.equal(created.response.status, 201);
    const announcementId = created.payload.announcement.id;

    const updatePath = `/core/pr/announcements/${announcementId}`;
    const memberPatchHeaders = signedCoreHeaders({
      method: 'PATCH',
      path: updatePath,
      actor: ACTORS.memberAi,
    });
    const blockedPatch = await requestJson(server, {
      method: 'PATCH',
      path: updatePath,
      headers: memberPatchHeaders,
      body: { title: 'Unauthorized update' },
    });
    assert.equal(blockedPatch.response.status, 403);

    const deletePath = `/core/pr/announcements/${announcementId}`;
    const memberDeleteHeaders = signedCoreHeaders({
      method: 'DELETE',
      path: deletePath,
      actor: ACTORS.memberAi,
    });
    const blockedDelete = await requestJson(server, {
      method: 'DELETE',
      path: deletePath,
      headers: memberDeleteHeaders,
    });
    assert.equal(blockedDelete.response.status, 403);

    const listPath = '/core/pr/announcements?committeeId=11111111-1111-4111-8111-111111111111';
    const memberListHeaders = signedCoreHeaders({
      method: 'GET',
      path: '/core/pr/announcements',
      actor: ACTORS.memberAi,
    });
    const blockedList = await requestJson(server, {
      method: 'GET',
      path: listPath,
      headers: memberListHeaders,
    });
    assert.equal(blockedList.response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
