const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');

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
    assert.ok(body.allowedFolders.includes('resources'));
    assert.ok(body.allowedFolders.includes('avatars'));
    assert.ok(body.allowedFolders.includes('applications'));
    assert.equal(body.creditSavingPolicy.autoFormat, true);
    assert.equal(body.creditSavingPolicy.autoQuality, true);
    assert.equal(body.creditSavingPolicy.maxImageSizeMb, 5);
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
});
