const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateFiles } = require('../../src/middlewares/validateFiles');
const { pool, closePool } = require('../../src/db');
const { runMigrations } = require('../../src/db/migrations');

describe('validateFiles Middleware Unit Tests', () => {
  before(async () => {
    await runMigrations({ pool });
    // Seed a known test asset in file_assets
    await pool.query(
      `INSERT INTO file_assets (
        id,
        purpose,
        cloudinary_asset_id,
        cloudinary_public_id,
        secure_url,
        resource_type,
        format
      ) VALUES (
        '11111111-2222-3333-4444-555555555555',
        'avatar',
        'cld_asset_unit_123',
        'ieee_portal/avatars/unit_test_user',
        'https://res.cloudinary.com/demo/image/upload/v123/ieee_portal/avatars/unit_test_user.jpg',
        'image',
        'jpg'
      ) ON CONFLICT DO NOTHING`
    );
  });

  after(async () => {
    await closePool();
  });

  test('passes with valid registered files payload', async () => {
    const middleware = validateFiles({
      required: ['avatar'],
      allowed: ['avatar'],
      maxCount: 1,
      checkDatabase: true,
    });

    const req = {
      body: {
        files: [
          {
            identifier: 'avatar',
            fileurl: 'https://res.cloudinary.com/demo/image/upload/v123/ieee_portal/avatars/unit_test_user.jpg',
            cloudinaryPublicId: 'ieee_portal/avatars/unit_test_user',
            cloudinaryAssetId: 'cld_asset_unit_123',
          },
        ],
      },
      identity: {
        userRefId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        role: 'member',
      },
    };

    let nextCalled = false;
    let nextError = null;

    await middleware(req, {}, (err) => {
      nextCalled = true;
      nextError = err;
    });

    assert.equal(nextCalled, true);
    assert.equal(nextError, undefined);
    assert.equal(req.body.files.length, 1);
    assert.equal(req.body.files[0].identifier, 'avatar');
  });

  test('rejects request when required files array is missing', async () => {
    const middleware = validateFiles({ required: ['avatar'] });
    const req = { body: {} };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /must contain a 'files' array/i);
  });

  test('rejects request when files is not an array', async () => {
    const middleware = validateFiles({ required: ['avatar'] });
    const req = { body: { files: 'invalid-string' } };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /must be an array/i);
  });

  test('rejects request when required identifier is missing', async () => {
    const middleware = validateFiles({ required: ['avatar', 'banner'] });
    const req = {
      body: {
        files: [
          {
            identifier: 'avatar',
            fileurl: 'https://res.cloudinary.com/demo/image.jpg',
            cloudinaryPublicId: 'pub_1',
            cloudinaryAssetId: 'asset_1',
          },
        ],
      },
    };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /Missing required file with identifier 'banner'/i);
  });

  test('rejects request when identifier is not allowed', async () => {
    const middleware = validateFiles({ allowed: ['avatar'] });
    const req = {
      body: {
        files: [
          {
            identifier: 'malicious_payload',
            fileurl: 'https://res.cloudinary.com/demo/image.jpg',
            cloudinaryPublicId: 'pub_1',
            cloudinaryAssetId: 'asset_1',
          },
        ],
      },
    };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /is not allowed for this endpoint/i);
  });

  test('rejects request when maxCount is exceeded', async () => {
    const middleware = validateFiles({ maxCount: 1 });
    const req = {
      body: {
        files: [
          {
            identifier: 'avatar',
            fileurl: 'https://res.cloudinary.com/demo/image1.jpg',
            cloudinaryPublicId: 'pub_1',
            cloudinaryAssetId: 'asset_1',
          },
          {
            identifier: 'avatar',
            fileurl: 'https://res.cloudinary.com/demo/image2.jpg',
            cloudinaryPublicId: 'pub_2',
            cloudinaryAssetId: 'asset_2',
          },
        ],
      },
    };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /exceeds maximum allowed count/i);
  });

  test('rejects request with invalid/insecure URL', async () => {
    const middleware = validateFiles({ checkDatabase: false });
    const req = {
      body: {
        files: [
          {
            identifier: 'avatar',
            fileurl: 'javascript:alert(1)',
            cloudinaryPublicId: 'pub_1',
            cloudinaryAssetId: 'asset_1',
          },
        ],
      },
    };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /must be a valid secure URL/i);
  });

  test('rejects request with spoofed/unregistered asset when checkDatabase is true', async () => {
    const middleware = validateFiles({ checkDatabase: true });
    const req = {
      body: {
        files: [
          {
            identifier: 'avatar',
            fileurl: 'https://res.cloudinary.com/demo/spoofed.jpg',
            cloudinaryPublicId: 'ieee_portal/avatars/unregistered_spoofed_public_id',
            cloudinaryAssetId: 'unregistered_asset_id_9999',
          },
        ],
      },
    };

    let capturedError = null;
    await middleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.ok(capturedError);
    assert.equal(capturedError.status, 400);
    assert.match(capturedError.message, /was not registered in file registry/i);
  });
});
