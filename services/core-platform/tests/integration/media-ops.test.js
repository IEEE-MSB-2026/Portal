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

        const publishEmptyPath = `/core/media/albums/${albumId}/publish`;
        const publisherEmptyPublishHeaders = signedCoreHeaders({
          method: 'POST',
          path: publishEmptyPath,
          actor: ACTORS.publisherGlobal,
        });

        // 1. Publishing an empty album with 0 assets must fail with 400
        const emptyPublish = await requestJson(server, {
          method: 'POST',
          path: publishEmptyPath,
          headers: publisherEmptyPublishHeaders,
        });
        assert.equal(emptyPublish.response.status, 400);
        assert.ok(emptyPublish.payload.error.includes('at least one media asset'));

        // 2. Add an asset to the album
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
        assert.equal(published.payload.album.coverImageUrl, 'https://cdn.example.com/media/asset-1.jpg');
        assert.equal(published.payload.album.assetsCount, 1);
        assert.equal(published.payload.album.assets.length, 1);

        // 3. Test creating an album with initial assets in one atomic call
        const createdWithAssets = await requestJson(server, {
          method: 'POST',
          path: createAlbumPath,
          headers: createHeaders,
          body: {
            committeeId: IDS.committees.hr,
            title: 'Hackathon 2026 Live Highlights',
            coverImageUrl: 'https://cdn.example.com/media/custom-cover.jpg',
            assets: [
              { assetUrl: 'https://cdn.example.com/media/shot-1.jpg', assetType: 'image', caption: 'Teams coding' },
              { assetUrl: 'https://cdn.example.com/media/shot-2.jpg', assetType: 'image', caption: 'Final awards' },
            ],
          },
        });
        assert.equal(createdWithAssets.response.status, 201);
        assert.equal(createdWithAssets.payload.album.coverImageUrl, 'https://cdn.example.com/media/custom-cover.jpg');
        assert.equal(createdWithAssets.payload.album.assetsCount, 2);
        assert.equal(createdWithAssets.payload.album.assets.length, 2);

        // 4. Test public listing returns embedded assets
        const publicList = await requestJson(server, {
          method: 'GET',
          path: '/public/media/albums',
        });
        assert.equal(publicList.response.status, 200);
        const publishedAlbum = publicList.payload.albums.find((a) => a.id === albumId);
        assert.ok(publishedAlbum);
        assert.equal(publishedAlbum.coverImageUrl, 'https://cdn.example.com/media/asset-1.jpg');
        assert.equal(publishedAlbum.assetsCount, 1);
        assert.equal(publishedAlbum.assets[0].assetUrl, 'https://cdn.example.com/media/asset-1.jpg');
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

test('media studio: stats, album lifecycle (update, asset delete, unpublish, delete) and brand assets CRUD', async () => {
  await prepareDatabase();

  await withEnv(
    {
      MEDIA_COMMITTEE_ID: IDS.committees.hr,
    },
    async () => {
      const app = loadFreshApp();
      const server = await createServer(app);

      try {
        // 1. Check media stats endpoint
        const statsHeaders = signedCoreHeaders({
          method: 'GET',
          path: '/core/media/stats',
          actor: ACTORS.leadHr,
        });
        const initialStats = await requestJson(server, {
          method: 'GET',
          path: '/core/media/stats',
          headers: statsHeaders,
        });
        assert.equal(initialStats.response.status, 200);
        assert.ok(typeof initialStats.payload.totalAlbums === 'number');
        assert.ok(typeof initialStats.payload.totalAssets === 'number');

        // 2. Create album with rich metadata (eventDate, category, tags)
        const createAlbumHeaders = signedCoreHeaders({
          method: 'POST',
          path: '/core/media/albums',
          actor: ACTORS.leadHr,
        });
        const created = await requestJson(server, {
          method: 'POST',
          path: '/core/media/albums',
          headers: createAlbumHeaders,
          body: {
            committeeId: IDS.committees.hr,
            title: 'Annual Gala 2026',
            description: 'Celebration photos and videos',
            category: 'Ceremony',
            eventDate: '2026-05-15',
            tags: ['gala', 'awards', '2026'],
            assets: [
              { assetUrl: 'https://cdn.example.com/media/gala1.jpg', assetType: 'image', caption: 'Stage opening' },
              { assetUrl: 'https://cdn.example.com/media/gala2.jpg', assetType: 'image', caption: 'Award winners' },
            ],
          },
        });
        assert.equal(created.response.status, 201);
        const album = created.payload.album;
        assert.equal(album.title, 'Annual Gala 2026');
        assert.equal(album.category, 'Ceremony');
        assert.deepEqual(album.tags, ['gala', 'awards', '2026']);
        assert.equal(album.assetsCount, 2);
        assert.equal(album.assets.length, 2);

        const asset1Id = album.assets[0].id;
        const asset2Id = album.assets[1].id;

        // 3. Update album metadata
        const updateHeaders = signedCoreHeaders({
          method: 'PATCH',
          path: `/core/media/albums/${album.id}`,
          actor: ACTORS.leadHr,
        });
        const updated = await requestJson(server, {
          method: 'PATCH',
          path: `/core/media/albums/${album.id}`,
          headers: updateHeaders,
          body: {
            title: 'Annual Gala 2026 - Official',
            category: 'Annual Event',
            tags: ['gala', 'official'],
          },
        });
        assert.equal(updated.response.status, 200);
        assert.equal(updated.payload.album.title, 'Annual Gala 2026 - Official');
        assert.equal(updated.payload.album.category, 'Annual Event');
        assert.deepEqual(updated.payload.album.tags, ['gala', 'official']);

        // 4. Delete an asset from album
        const deleteAssetHeaders = signedCoreHeaders({
          method: 'DELETE',
          path: `/core/media/albums/${album.id}/assets/${asset2Id}`,
          actor: ACTORS.leadHr,
        });
        const deletedAssetRes = await requestJson(server, {
          method: 'DELETE',
          path: `/core/media/albums/${album.id}/assets/${asset2Id}`,
          headers: deleteAssetHeaders,
        });
        assert.equal(deletedAssetRes.response.status, 200);

        // Verify remaining asset count is 1
        const getAlbumRes = await requestJson(server, {
          method: 'GET',
          path: `/core/media/albums/${album.id}`,
          headers: signedCoreHeaders({
            method: 'GET',
            path: `/core/media/albums/${album.id}`,
            actor: ACTORS.leadHr,
          }),
        });
        assert.equal(getAlbumRes.response.status, 200);
        assert.equal(getAlbumRes.payload.album.assetsCount, 1);
        assert.equal(getAlbumRes.payload.album.assets[0].id, asset1Id);

        // 5. Publish album
        const publishRes = await requestJson(server, {
          method: 'POST',
          path: `/core/media/albums/${album.id}/publish`,
          headers: signedCoreHeaders({
            method: 'POST',
            path: `/core/media/albums/${album.id}/publish`,
            actor: ACTORS.publisherGlobal,
          }),
        });
        assert.equal(publishRes.response.status, 200);
        assert.equal(publishRes.payload.album.status, 'published');

        // 6. Unpublish album
        const unpublishRes = await requestJson(server, {
          method: 'POST',
          path: `/core/media/albums/${album.id}/unpublish`,
          headers: signedCoreHeaders({
            method: 'POST',
            path: `/core/media/albums/${album.id}/unpublish`,
            actor: ACTORS.publisherGlobal,
          }),
        });
        assert.equal(unpublishRes.response.status, 200);
        assert.equal(unpublishRes.payload.album.status, 'draft');

        // 7. Brand Assets: Create, List, Update, Delete
        const createBrandHeader = signedCoreHeaders({
          method: 'POST',
          path: '/core/media/brand-assets',
          actor: ACTORS.leadHr,
        });
        const brandCreated = await requestJson(server, {
          method: 'POST',
          path: '/core/media/brand-assets',
          headers: createBrandHeader,
          body: {
            title: 'IEEE MSB Dark Logo Vector',
            category: 'Logos',
            fileUrl: 'https://cdn.example.com/brand/logo-dark.svg',
            thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/v1/brand_thumb.jpg',
            fileType: 'svg',
            fileSizeBytes: 24500,
            dimensions: '800x600',
            description: 'Primary vector logo with dark gradient',
            tags: ['logo', 'vector', 'dark'],
          },
        });
        assert.equal(brandCreated.response.status, 201);
        const brandAssetId = brandCreated.payload.asset.id;
        assert.equal(brandCreated.payload.asset.title, 'IEEE MSB Dark Logo Vector');
        assert.equal(brandCreated.payload.asset.category, 'logos');
        assert.deepEqual(brandCreated.payload.asset.tags, ['logo', 'vector', 'dark']);

        // List brand assets with filter
        const brandList = await requestJson(server, {
          method: 'GET',
          path: '/core/media/brand-assets?category=logos',
          headers: signedCoreHeaders({
            method: 'GET',
            path: '/core/media/brand-assets',
            actor: ACTORS.leadHr,
          }),
        });
        assert.equal(brandList.response.status, 200);
        assert.ok(brandList.payload.assets.length >= 1);
        assert.equal(brandList.payload.assets[0].category, 'logos');

        // Update brand asset with new thumbnail
        const updateBrand = await requestJson(server, {
          method: 'PATCH',
          path: `/core/media/brand-assets/${brandAssetId}`,
          headers: signedCoreHeaders({
            method: 'PATCH',
            path: `/core/media/brand-assets/${brandAssetId}`,
            actor: ACTORS.leadHr,
          }),
          body: {
            title: 'IEEE MSB Dark Logo Vector (Updated)',
            thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/v2/brand_thumb_updated.jpg',
          },
        });
        assert.equal(updateBrand.response.status, 200);
        assert.equal(updateBrand.payload.asset.title, 'IEEE MSB Dark Logo Vector (Updated)');

        const { query } = require('../../src/db/pool');
        // Verify old thumbnail was queued into file_assets
        const thumbQueueCheck = await query(
          "SELECT status, secure_url FROM file_assets WHERE secure_url = $1",
          ['https://res.cloudinary.com/demo/image/upload/v1/brand_thumb.jpg']
        );
        assert.equal(thumbQueueCheck.rows.length, 1);
        assert.equal(thumbQueueCheck.rows[0].status, 'pending_deletion');

        // Delete brand asset
        const deleteBrand = await requestJson(server, {
          method: 'DELETE',
          path: `/core/media/brand-assets/${brandAssetId}`,
          headers: signedCoreHeaders({
            method: 'DELETE',
            path: `/core/media/brand-assets/${brandAssetId}`,
            actor: ACTORS.leadHr,
          }),
        });
        assert.equal(deleteBrand.response.status, 200);

        // Verify updated thumbnail was queued into file_assets on delete
        const thumb2QueueCheck = await query(
          "SELECT status, secure_url FROM file_assets WHERE secure_url = $1",
          ['https://res.cloudinary.com/demo/image/upload/v2/brand_thumb_updated.jpg']
        );
        assert.equal(thumb2QueueCheck.rows.length, 1);
        assert.equal(thumb2QueueCheck.rows[0].status, 'pending_deletion');

        // 8. Delete album
        const deleteAlbumRes = await requestJson(server, {
          method: 'DELETE',
          path: `/core/media/albums/${album.id}`,
          headers: signedCoreHeaders({
            method: 'DELETE',
            path: `/core/media/albums/${album.id}`,
            actor: ACTORS.leadHr,
          }),
        });
        assert.equal(deleteAlbumRes.response.status, 200);
        assert.equal(deleteAlbumRes.payload.success, true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
});

test('media albums: support branch-wide albums with optional committeeId', async () => {
  await prepareDatabase();

  await withEnv(
    {
      MEDIA_COMMITTEE_ID: IDS.committees.hr,
    },
    async () => {
      const app = loadFreshApp();
      const server = await createServer(app);

      try {
        // Create branch-wide album without committeeId
        const createRes = await requestJson(server, {
          method: 'POST',
          path: '/core/media/albums',
          headers: signedCoreHeaders({
            method: 'POST',
            path: '/core/media/albums',
            actor: ACTORS.publisherGlobal,
          }),
          body: {
            title: 'IEEE Annual Gala 2026',
            description: 'Branch-wide annual gala celebration',
            category: 'Celebration',
            tags: ['gala', 'branch_wide', 'celebration'],
            assets: [
              {
                assetUrl: 'https://res.cloudinary.com/demo/image/upload/v1/gala-1.jpg',
                assetType: 'image',
                caption: 'Opening ceremony',
              },
            ],
          },
        });

        assert.equal(createRes.response.status, 201);
        const album = createRes.payload.album;
        assert.equal(album.title, 'IEEE Annual Gala 2026');
        assert.equal(album.committeeId, null);
        assert.equal(album.committeeName, null);
        assert.equal(album.category, 'Celebration');
        assert.equal(album.assetsCount, 1);

        // Publish the branch-wide album
        const publishRes = await requestJson(server, {
          method: 'POST',
          path: `/core/media/albums/${album.id}/publish`,
          headers: signedCoreHeaders({
            method: 'POST',
            path: `/core/media/albums/${album.id}/publish`,
            actor: ACTORS.publisherGlobal,
          }),
        });
        assert.equal(publishRes.response.status, 200);
        assert.equal(publishRes.payload.album.status, 'published');

        // Check public albums endpoint returns the branch-wide album
        const publicRes = await requestJson(server, {
          method: 'GET',
          path: '/public/media/albums',
        });
        assert.equal(publicRes.response.status, 200);
        const publicAlbum = publicRes.payload.albums.find((a) => a.id === album.id);
        assert.ok(publicAlbum);
        assert.equal(publicAlbum.committeeId, null);
        assert.equal(publicAlbum.title, 'IEEE Annual Gala 2026');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
});

