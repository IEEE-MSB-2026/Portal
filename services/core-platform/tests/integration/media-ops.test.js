const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

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

const CORE_SRC_ROOT = path.resolve(__dirname, '../../src');
const CORE_POOL_MODULE_SUFFIX = path.join('src', 'db', 'pool.js');

function clearCoreModuleCache() {
  for (const modulePath of Object.keys(require.cache)) {
    if (!modulePath.startsWith(CORE_SRC_ROOT)) continue;
    if (modulePath.endsWith(CORE_POOL_MODULE_SUFFIX)) continue;
    delete require.cache[modulePath];
  }
}

function loadFreshApp() {
  clearCoreModuleCache();
  return require('../../src/app');
}

async function withEnv(overrides, run) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearCoreModuleCache();
  }
}

async function requestJson(server, { method, path: routePath, headers, body }) {
  const response = await fetch(`${getBaseUrl(server)}${routePath}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json();
  return { response, payload };
}

function signedCoreHeaders({ method, path: routePath, actor }) {
  return signedHeaders({
    method,
    path: routePath,
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
  leadHr: {
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.hr,
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
  clearCoreModuleCache();
});

test('media albums: lead can create/add assets but cannot publish without publisher/admin', async () => {
  await prepareDatabase();

  await withEnv(
    {
      MEDIA_COMMITTEE_ID: IDS.committees.hr,
    },
    async () => {
      const app = loadFreshApp();
      const server = await createServer(app);

      try {
        const createAlbumPath = '/core/media/albums';
        const createHeaders = signedCoreHeaders({
          method: 'POST',
          path: createAlbumPath,
          actor: ACTORS.leadHr,
        });

        const createdAlbum = await requestJson(server, {
          method: 'POST',
          path: createAlbumPath,
          headers: createHeaders,
          body: {
            committeeId: IDS.committees.hr,
            title: 'Event Coverage Album',
            description: 'Spring event media',
          },
        });
        assert.equal(createdAlbum.response.status, 201);
        const albumId = createdAlbum.payload.album.id;

        const addAssetPath = `/core/media/albums/${albumId}/assets`;
        const addAssetHeaders = signedCoreHeaders({
          method: 'POST',
          path: addAssetPath,
          actor: ACTORS.leadHr,
        });
        const addedAsset = await requestJson(server, {
          method: 'POST',
          path: addAssetPath,
          headers: addAssetHeaders,
          body: {
            assetUrl: 'https://cdn.example.com/media/asset-1.jpg',
            assetType: 'image',
            caption: 'Opening keynote',
          },
        });
        assert.equal(addedAsset.response.status, 201);

        const publishPath = `/core/media/albums/${albumId}/publish`;
        const leadPublishHeaders = signedCoreHeaders({
          method: 'POST',
          path: publishPath,
          actor: ACTORS.leadHr,
        });
        const leadPublish = await requestJson(server, {
          method: 'POST',
          path: publishPath,
          headers: leadPublishHeaders,
        });
        assert.equal(leadPublish.response.status, 403);

        const publisherPublishHeaders = signedCoreHeaders({
          method: 'POST',
          path: publishPath,
          actor: ACTORS.publisherGlobal,
        });
        const published = await requestJson(server, {
          method: 'POST',
          path: publishPath,
          headers: publisherPublishHeaders,
        });
        assert.equal(published.response.status, 200);
        assert.equal(published.payload.album.status, 'published');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
});

test('media coverage: accepted status creates exactly one linked task and is idempotent', async () => {
  await prepareDatabase();

  await withEnv(
    {
      MEDIA_COMMITTEE_ID: IDS.committees.hr,
    },
    async () => {
      const app = loadFreshApp();
      const server = await createServer(app);

      try {
        const createPath = '/core/media/coverage-requests';
        const createHeaders = signedCoreHeaders({
          method: 'POST',
          path: createPath,
          actor: ACTORS.leadAi,
        });

        const created = await requestJson(server, {
          method: 'POST',
          path: createPath,
          headers: createHeaders,
          body: {
            committeeId: IDS.committees.ai,
            title: 'AI Bootcamp Coverage',
            description: 'Capture photos and recap clips.',
            eventAt: '2026-03-01T18:00:00.000Z',
          },
        });
        assert.equal(created.response.status, 201);

        const requestId = created.payload.request.id;
        const statusPath = `/core/media/coverage-requests/${requestId}/status`;
        const leadHrHeaders = signedCoreHeaders({
          method: 'PATCH',
          path: statusPath,
          actor: ACTORS.leadHr,
        });

        const accepted = await requestJson(server, {
          method: 'PATCH',
          path: statusPath,
          headers: leadHrHeaders,
          body: {
            status: 'accepted',
            notes: 'Assigned for coverage',
          },
        });
        assert.equal(accepted.response.status, 200);
        assert.equal(accepted.payload.request.status, 'accepted');
        assert.ok(accepted.payload.request.linkedTaskId);

        const firstLinkedTaskId = accepted.payload.request.linkedTaskId;
        const acceptedAgain = await requestJson(server, {
          method: 'PATCH',
          path: statusPath,
          headers: leadHrHeaders,
          body: {
            status: 'accepted',
          },
        });
        assert.equal(acceptedAgain.response.status, 200);
        assert.equal(acceptedAgain.payload.request.linkedTaskId, firstLinkedTaskId);

        const linkedTasks = await query(
          `
            SELECT COUNT(*)::int AS c
            FROM tasks
            WHERE committee_id = $1
              AND title = 'Coverage: AI Bootcamp Coverage'
          `,
          [IDS.committees.hr]
        );
        assert.equal(linkedTasks.rows[0].c, 1);

        const requestRow = await query(
          'SELECT linked_task_id, status FROM media_coverage_requests WHERE id = $1',
          [requestId]
        );
        assert.equal(requestRow.rows[0].status, 'accepted');
        assert.equal(requestRow.rows[0].linked_task_id, firstLinkedTaskId);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
});
