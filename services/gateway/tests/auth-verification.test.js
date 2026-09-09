const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const app = require('../src/app');
const { getPool, closePool } = require('../src/db/pool');

describe('Email Verification & Google SSO Authentication Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  describe('Email Verification Workflow', () => {
    let registeredUserEmail = `verify-${Date.now()}@ieee.local`;
    let userAuthToken;
    let userId;
    let rawToken;

    test('Registration creates unverified user and sets verification token directly on users table', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Verification Candidate',
          email: registeredUserEmail,
          password: 'Password123!',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.token);
      assert.equal(data.user.email, registeredUserEmail);
      assert.equal(data.user.isEmailVerified, false);

      userAuthToken = data.token;
      userId = data.user.id;

      // Check users table directly for verification token hash and expiration
      const pool = getPool();
      const result = await pool.query(
        'SELECT is_email_verified, email_verification_token_hash, email_verification_expires_at, email_verification_sent_at FROM users WHERE id = $1',
        [userId]
      );

      assert.equal(result.rows.length, 1);
      const userRow = result.rows[0];
      assert.equal(userRow.is_email_verified, false);
      assert.ok(userRow.email_verification_token_hash);
      assert.ok(userRow.email_verification_expires_at);
      assert.ok(userRow.email_verification_sent_at);
    });

    test('POST /api/auth/verify-email rejects missing or invalid token', async () => {
      const emptyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      });
      assert.equal(emptyRes.status, 400);

      const invalidRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-fake-token-00000000000000000000000000000000' }),
      });
      assert.equal(invalidRes.status, 400);
      const invalidData = await invalidRes.json();
      assert.match(invalidData.error, /invalid or expired/i);
    });

    test('POST /api/auth/verify-email validates token, marks user verified, and clears token', async () => {
      // Set a known token on the user row for testing verification
      const testToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(testToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const pool = getPool();
      await pool.query(
        'UPDATE users SET email_verification_token_hash = $1, email_verification_expires_at = $2 WHERE id = $3',
        [tokenHash, expiresAt, userId]
      );

      const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: testToken }),
      });

      assert.equal(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.equal(verifyData.success, true);
      assert.equal(verifyData.user.isEmailVerified, true);

      // Verify users table state in database
      const rowCheck = await pool.query(
        'SELECT is_email_verified, email_verification_token_hash, email_verification_expires_at FROM users WHERE id = $1',
        [userId]
      );
      assert.equal(rowCheck.rows[0].is_email_verified, true);
      assert.equal(rowCheck.rows[0].email_verification_token_hash, null);
      assert.equal(rowCheck.rows[0].email_verification_expires_at, null);

      // Re-verifying with the same token now fails
      const reVerifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: testToken }),
      });
      assert.equal(reVerifyRes.status, 400);
    });

    test('POST /api/auth/verify-email rejects expired tokens', async () => {
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
      const pastExpiry = new Date(Date.now() - 3600 * 1000); // 1 hour ago

      const pool = getPool();
      await pool.query(
        'UPDATE users SET is_email_verified = false, email_verification_token_hash = $1, email_verification_expires_at = $2 WHERE id = $3',
        [expiredHash, pastExpiry, userId]
      );

      const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: expiredToken }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /expired/i);
    });

    test('POST /api/auth/resend-verification enforces 60-second cooldown and generates new token', async () => {
      // 1. Resend without auth fails with 401
      const unauthRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(unauthRes.status, 401);

      // 2. Mark user unverified with a sent_at from 2 minutes ago to test clean resend
      const pool = getPool();
      const pastSent = new Date(Date.now() - 120 * 1000);
      await pool.query(
        'UPDATE users SET is_email_verified = false, email_verification_sent_at = $1 WHERE id = $2',
        [pastSent, userId]
      );

      const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${userAuthToken}`,
        },
      });

      assert.equal(resendRes.status, 200);
      const resendData = await resendRes.json();
      assert.equal(resendData.success, true);
      assert.ok(resendData.message);

      // 3. Immediate second resend triggers 429 cooldown
      const immediateRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${userAuthToken}`,
        },
      });

      assert.equal(immediateRes.status, 429);
      const cooldownData = await immediateRes.json();
      assert.match(cooldownData.error, /wait.*seconds/i);
      assert.ok(cooldownData.cooldownSeconds > 0);
    });

    test('POST /api/auth/resend-verification allows unauthenticated resend with email body', async () => {
      // Mark sent_at in past to bypass cooldown
      const pool = getPool();
      const pastSent = new Date(Date.now() - 120 * 1000);
      await pool.query(
        'UPDATE users SET is_email_verified = false, email_verification_sent_at = $1 WHERE id = $2',
        [pastSent, userId]
      );

      const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: registeredUserEmail }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.message);
    });

    test('POST /api/auth/resend-verification accepts dynamic Origin header', async () => {
      const pool = getPool();
      const pastSent = new Date(Date.now() - 120 * 1000);
      await pool.query(
        'UPDATE users SET is_email_verified = false, email_verification_sent_at = $1 WHERE id = $2',
        [pastSent, userId]
      );

      const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://portal.ieeemsb.org',
          authorization: `Bearer ${userAuthToken}`,
        },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
    });
  });

  describe('Google SSO Flow & Collision Policy', () => {
    test('POST /api/auth/google rejects missing credential', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });

    test('POST /api/auth/google provisions new user when new Google account signs in', async () => {
      const uniqueSub = `goog-sub-${Date.now()}`;
      const uniqueEmail = `google.user.${Date.now()}@gmail.com`;
      const credential = `test-mock-google:${uniqueSub}:${uniqueEmail}:Ada Lovelace:https://example.com/avatar.jpg`;

      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.ok(data.refreshToken);
      assert.equal(data.user.email, uniqueEmail);
      assert.equal(data.user.name, 'Ada Lovelace');
      assert.equal(data.user.role, 'member');
      assert.equal(data.user.isEmailVerified, true);
      assert.equal(data.user.authProvider, 'google');

      // Database check
      const pool = getPool();
      const dbCheck = await pool.query('SELECT * FROM users WHERE email = $1', [uniqueEmail]);
      assert.equal(dbCheck.rows.length, 1);
      assert.equal(dbCheck.rows[0].google_id, uniqueSub);
      assert.equal(dbCheck.rows[0].auth_provider, 'google');
      assert.equal(dbCheck.rows[0].is_email_verified, true);
      assert.equal(dbCheck.rows[0].password_hash, null);
    });

    test('POST /api/auth/google signs in existing Google account', async () => {
      const uniqueSub = `goog-returning-${Date.now()}`;
      const uniqueEmail = `returning.google.${Date.now()}@gmail.com`;
      const credential = `test-mock-google:${uniqueSub}:${uniqueEmail}:Grace Hopper:https://example.com/grace.jpg`;

      // First login creates account
      const firstRes = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      assert.equal(firstRes.status, 200);

      // Second login logs in existing account
      const secondRes = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      assert.equal(secondRes.status, 200);
      const data = await secondRes.json();
      assert.equal(data.user.email, uniqueEmail);
      assert.equal(data.user.authProvider, 'google');
    });

    test('POST /api/auth/google rejects with 409 Conflict if email already exists with password auth', async () => {
      // admin@ieee.local exists with local password auth
      const credential = `test-mock-google:sub-collision-999:admin@ieee.local:Fake Admin:`;

      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.match(data.error, /already exists.*password/i);
    });
  });
});
