const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const { closePool } = require('../src/db/pool');

describe('Cloudinary File Service Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closePool();
  });

  test('GET /health returns service status and upload mode', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'portal-file-service');
    assert.ok(body.uploadMode);
  });

  test('GET /api/files/config returns allowed folders and credit-saving policy', async () => {
    const res = await fetch(`${baseUrl}/api/files/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.allowedFolders));
    assert.ok(body.allowedFolders.includes('media_albums'));
    assert.ok(body.allowedFolders.includes('brand_kit'));
    assert.ok(body.allowedFolders.includes('resources'));
    assert.ok(body.allowedFolders.includes('avatars'));
    assert.ok(body.allowedFolders.includes('applications'));
    assert.equal(body.creditSavingPolicy.autoFormat, true);
    assert.equal(body.creditSavingPolicy.autoQuality, true);
    assert.equal(body.creditSavingPolicy.maxImageSizeMb, 10);
  });

  test('POST /api/files/signature normalizes event_albums alias to media_albums', async () => {
    const res = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'admin-1',
        'x-user-role': 'admin',
      },
      body: JSON.stringify({
        folder: 'event_albums',
        resourceType: 'image',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.folder, 'ieee_portal/media_albums');
  });

  test('POST /api/files/signature supports brand_kit folder', async () => {
    const res = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'admin-1',
        'x-user-role': 'admin',
      },
      body: JSON.stringify({
        folder: 'brand_kit',
        resourceType: 'raw',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.folder, 'ieee_portal/brand_kit');
  });

  test('POST /api/files/signature generates signed parameters with auto credit-saving transforms', async () => {
    const res = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'admin-1',
        'x-user-role': 'admin',
      },
      body: JSON.stringify({
        folder: 'media_albums',
        resourceType: 'image',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.uploadUrl);
    assert.ok(body.signature);
    assert.ok(body.timestamp);
    assert.equal(body.folder, 'ieee_portal/media_albums');
    assert.equal(body.eager, 'f_auto,q_auto,c_limit,w_1920,h_1080');
    assert.equal(body.creditSavingPolicy.autoFormat, true);
  });

  test('POST /api/files/signature for avatar folder uses avatar face crop transform', async () => {
    const res = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'member-1',
        'x-user-role': 'member',
      },
      body: JSON.stringify({
        folder: 'avatars',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.folder, 'ieee_portal/avatars');
    assert.equal(body.eager, 'f_auto,q_auto,c_fill,w_400,h_400,g_face');
  });

  test('POST /api/files/signature rejects invalid folder name with 400', async () => {
    const res = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'member-1',
        'x-user-role': 'member',
      },
      body: JSON.stringify({
        folder: 'unauthorized_folder_xyz',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Invalid folder'));
  });

  test('POST /api/files/signature restricts applicant role to applications folder', async () => {
    // 1. Allowed folder
    const allowRes = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'applicant-1',
        'x-user-role': 'applicant',
      },
      body: JSON.stringify({
        folder: 'applications',
      }),
    });
    assert.equal(allowRes.status, 200);

    // 2. Forbidden folder for applicant
    const forbidRes = await fetch(`${baseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'applicant-1',
        'x-user-role': 'applicant',
      },
      body: JSON.stringify({
        folder: 'media_albums',
      }),
    });
    assert.equal(forbidRes.status, 403);
  });

  test('POST /api/files/upload handles multipart upload with credit saving fallback', async () => {
    const formBoundary = '----WebKitFormBoundaryTest12345';
    const fileContent = 'dummy image content for testing';
    const bodyParts = [
      `--${formBoundary}`,
      'Content-Disposition: form-data; name="folder"',
      '',
      'resources',
      `--${formBoundary}`,
      'Content-Disposition: form-data; name="file"; filename="workshop-slides.pdf"',
      'Content-Type: application/pdf',
      '',
      fileContent,
      `--${formBoundary}--`,
    ].join('\r\n');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${formBoundary}`,
        'x-user-id': 'lead-1',
        'x-user-role': 'lead',
      },
      body: bodyParts,
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.file.secureUrl);
    assert.equal(body.file.folder, 'ieee_portal/resources');
  });

  test('POST /api/files/assets rejects files exceeding 10MB limit with 400', async () => {
    const res = await fetch(`${baseUrl}/api/files/assets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'lead-1',
        'x-user-role': 'lead',
      },
      body: JSON.stringify({
        cloudinaryAssetId: 'test-oversized-asset',
        cloudinaryPublicId: 'ieee_portal/resources/huge-file',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/ieee_portal/resources/huge-file.pdf',
        bytes: 12 * 1024 * 1024, // 12MB > 10MB
        purpose: 'resources',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('10MB'));
  });

  test('POST /api/files/assets registers valid file <= 10MB and DELETE /assets/:id removes it', async () => {
    const registerRes = await fetch(`${baseUrl}/api/files/assets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'lead-1',
        'x-user-role': 'lead',
      },
      body: JSON.stringify({
        cloudinaryAssetId: 'test-valid-asset-123',
        cloudinaryPublicId: 'ieee_portal/resources/valid-file',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/ieee_portal/resources/valid-file.pdf',
        bytes: 4 * 1024 * 1024, // 4MB
        purpose: 'resources',
      }),
    });

    assert.equal(registerRes.status, 201);
    const regBody = await registerRes.json();
    assert.equal(regBody.success, true);
    const assetId = regBody.asset.id;

    // Now delete by ID
    const deleteRes = await fetch(`${baseUrl}/api/files/assets/${assetId}`, {
      method: 'DELETE',
      headers: {
        'x-user-id': 'lead-1',
        'x-user-role': 'lead',
      },
    });

    assert.equal(deleteRes.status, 200);
    const delBody = await deleteRes.json();
    assert.equal(delBody.success, true);
    assert.equal(delBody.deletedId, assetId);
  });

  test('DELETE /api/files/by-url deletes asset by Cloudinary URL', async () => {
    const targetUrl = 'https://res.cloudinary.com/demo/image/upload/v123456/ieee_portal/avatars/old_avatar_999.png';
    const res = await fetch(`${baseUrl}/api/files/by-url`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'member-1',
        'x-user-role': 'member',
      },
      body: JSON.stringify({ url: targetUrl }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.publicId, 'ieee_portal/avatars/old_avatar_999');
  });

  test('POST /api/files/cleanup/process-deletions drains outbox deletions from file_assets', async () => {
    const { query } = require('../src/db/pool');
    const testPublicId = `ieee_portal/general/test_deletion_${Date.now()}`;
    // Insert a test item into file_assets with status = 'pending_deletion'
    const insertRes = await query(
      `INSERT INTO file_assets (cloudinary_public_id, secure_url, resource_type, status, purpose)
       VALUES ($1, $2, 'image', 'pending_deletion', 'cleanup')
       RETURNING id`,
      [testPublicId, `https://res.cloudinary.com/demo/image/upload/${testPublicId}.jpg`]
    );
    const testAssetId = insertRes.rows[0].id;

    const res = await fetch(`${baseUrl}/api/files/cleanup/process-deletions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'admin-1',
        'x-user-role': 'admin',
      },
      body: JSON.stringify({ limit: 10 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.processedCount >= 1);

    // Verify row was hard-deleted from file_assets upon successful destruction
    const checkRes = await query('SELECT id FROM file_assets WHERE id = $1', [testAssetId]);
    assert.equal(checkRes.rows.length, 0);
  });

  test('POST /api/files/cleanup/orphans supports ?dryRun=true parameter', async () => {
    const res = await fetch(`${baseUrl}/api/files/cleanup/orphans?dryRun=true`, {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin',
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.dryRun, true);
    assert.ok(Array.isArray(body.orphans));
  });
});
