const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const config = require('../src/config');
const { getPool, closePool } = require('../src/db/pool');
const { buildCoreGatewayHeaders, buildEventClaimsHeaders } = require('../src/utils/signer');

describe('Gateway & IAM Service Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  test('GET /health returns status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'portal-gateway');
  });



  test('POST /api/auth/login validates credentials and issues JWT token + refresh token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ieee.local', password: 'password123' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.ok(body.refreshToken);
    assert.equal(body.user.email, 'admin@ieee.local');
    assert.equal(body.user.role, 'admin');

    const decoded = jwt.verify(body.token, config.jwtSecret);
    assert.equal(decoded.email, 'admin@ieee.local');
    assert.equal(decoded.role, 'admin');
  });

  test('POST /api/auth/login rejects invalid credentials with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ieee.local', password: 'wrong-password' }),
    });

    assert.equal(res.status, 401);
  });

  test('POST /api/auth/register creates a new user account with token pair', async () => {
    const uniqueEmail = `volunteer-${Date.now()}@ieee.local`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'New Volunteer',
        email: uniqueEmail,
        password: 'password123',
        role: 'member',
        committeeId: '11111111-1111-4111-8111-111111111111',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.token);
    assert.ok(body.refreshToken);
    assert.equal(body.user.email, uniqueEmail);
    assert.equal(body.user.scopeType, 'committee');
    assert.equal(body.user.scopeId, '11111111-1111-4111-8111-111111111111');
  });

  test('GET /api/auth/me returns current user identity with valid token', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lead.ai@ieee.local', password: 'password123' }),
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.email, 'lead.ai@ieee.local');
    assert.equal(meBody.user.role, 'lead');
    assert.equal(meBody.user.scopeType, 'committee');
  });

  test('POST /api/auth/switch-context validates server-side scopes and blocks unauthorized requests', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lead.ai@ieee.local', password: 'password123' }),
    });
    const { token, user } = await loginRes.json();
    assert.ok(user.availableScopes && user.availableScopes.length > 0);

    // 1. Authorized switch to possessed role/scope using targetScopeId from availableScopes
    const memberScope = user.availableScopes.find((s) => s.role === 'member' && s.scopeType === 'committee');
    assert.ok(memberScope);

    const validSwitchRes = await fetch(`${baseUrl}/api/auth/switch-context`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetScopeId: memberScope.id,
      }),
    });

    assert.equal(validSwitchRes.status, 200);
    const validBody = await validSwitchRes.json();
    assert.ok(validBody.token);
    assert.equal(validBody.user.role, 'member');
    assert.equal(validBody.user.activeScope.id, memberScope.id);

    // 2. Unauthorized switch to an unpossessed scope ID returns 403
    const forbiddenSwitchRes = await fetch(`${baseUrl}/api/auth/switch-context`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetScopeId: 'unauthorized-scope-uuid',
      }),
    });

    assert.equal(forbiddenSwitchRes.status, 403);
    const forbiddenBody = await forbiddenSwitchRes.json();
    assert.ok(forbiddenBody.error.includes('not possess'));
  });

  test('Refresh Token Rotation: POST /api/auth/refresh rotates token, allows grace window, and detects stale reuse', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lead.ai@ieee.local', password: 'password123' }),
    });
    const { refreshToken: firstRefreshToken } = await loginRes.json();
    assert.ok(firstRefreshToken);

    // Verify cookie path is restricted to /api/auth
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('Path=/api/auth'));

    // 1. First refresh succeeds and rotates token
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: firstRefreshToken }),
    });

    assert.equal(refreshRes.status, 200);
    const refreshBody = await refreshRes.json();
    assert.ok(refreshBody.token);
    assert.ok(refreshBody.refreshToken);
    assert.notEqual(refreshBody.refreshToken, firstRefreshToken);

    // 2. Concurrent request within grace window succeeds without terminating session
    const concurrentRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: firstRefreshToken }),
    });
    assert.equal(concurrentRes.status, 200);

    // 3. Stale replay attack beyond grace window: trigger reuse detection and return 403
    const pool = getPool();
    await pool.query('UPDATE auth_refresh_tokens SET revoked_at = $1 WHERE is_revoked = TRUE', [
      new Date(Date.now() - 30000),
    ]);

    const replayRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: firstRefreshToken }),
    });

    assert.equal(replayRes.status, 403);
    const replayBody = await replayRes.json();
    assert.ok(replayBody.error.includes('reuse detected'));
  });

  test('POST /api/auth/logout revokes session', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ieee.local', password: 'password123' }),
    });
    const { refreshToken } = await loginRes.json();

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    assert.equal(logoutRes.status, 200);
  });

  test('PATCH /api/auth/password validates current password and updates to new password', async () => {
    // 1. Register or login a user
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member.ai@ieee.local', password: 'password123' }),
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    // 2. Reject mismatching confirm password
    const mismatchRes = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'NewSecurePassword123!',
        confirmPassword: 'DifferentPassword123!',
      }),
    });
    assert.equal(mismatchRes.status, 400);

    // 3. Reject incorrect current password
    const wrongOldRes = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        currentPassword: 'wrongCurrentPassword',
        newPassword: 'NewSecurePassword123!',
        confirmPassword: 'NewSecurePassword123!',
      }),
    });
    assert.equal(wrongOldRes.status, 401);

    // 4. Successfully change password
    const successRes = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'NewSecurePassword123!',
        confirmPassword: 'NewSecurePassword123!',
      }),
    });
    assert.equal(successRes.status, 200);
    const successBody = await successRes.json();
    assert.ok(successBody.message.includes('successfully'));

    // 5. Login with new password succeeds
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member.ai@ieee.local', password: 'NewSecurePassword123!' }),
    });
    assert.equal(newLoginRes.status, 200);

    // 6. Reset password back for subsequent tests
    const resetRes = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${(await newLoginRes.json()).token}` },
      body: JSON.stringify({
        currentPassword: 'NewSecurePassword123!',
        newPassword: 'password123',
        confirmPassword: 'password123',
      }),
    });
    assert.equal(resetRes.status, 200);
  });

  test('Proxy to Core: returns 401 when invalid or expired Bearer token is provided', async () => {
    const expiredToken = jwt.sign(
      { sub: 'test-user', email: 'test@ieee.local' },
      config.jwtSecret,
      { expiresIn: '-10s' }
    );

    const res = await fetch(`${baseUrl}/api/core/hr/campaigns`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error.includes('expired') || body.error.includes('Invalid'));
  });

  test('Signer: buildCoreGatewayHeaders generates valid HMAC signature headers', () => {
    const headers = buildCoreGatewayHeaders(
      'GET',
      '/core/me/dashboard',
      {
        userId: 'user-123',
        email: 'user@ieee.local',
        role: 'member',
        scopeType: 'global',
        scopeId: 'global',
      },
      config.gatewaySharedSecret
    );

    assert.ok(headers['x-gateway-signature']);
    assert.ok(headers['x-gateway-timestamp']);
    assert.equal(headers['x-user-id'], 'user-123');
    assert.equal(headers['x-user-role'], 'member');
  });

  test('Signer: buildEventClaimsHeaders generates valid signed claims for Event Register', () => {
    const headers = buildEventClaimsHeaders(
      {
        role: 'scanner',
        scopeType: 'event',
        scopeId: '507f1f77bcf86cd799439011',
      },
      config.claimsHmacSecret
    );

    assert.ok(headers['x-auth-claims']);
    assert.ok(headers['x-auth-signature']);

    const raw = Buffer.from(headers['x-auth-claims'], 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.role, 'scanner');
    assert.equal(parsed.scope_type, 'event');
    assert.equal(parsed.scope_id, '507f1f77bcf86cd799439011');
  });

  test('POST /admin/roles/assign rejects missing x-service-token with 401', async () => {
    const res = await fetch(`${baseUrl}/admin/roles/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'applicant-1',
        role: 'member',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error.includes('x-service-token'));
  });

  test('POST /admin/roles/assign rejects invalid x-service-token with 401', async () => {
    const res = await fetch(`${baseUrl}/admin/roles/assign`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': 'wrong-token',
      },
      body: JSON.stringify({
        userId: 'applicant-1',
        role: 'member',
      }),
    });

    assert.equal(res.status, 401);
  });

  test('POST /admin/roles/assign accepts valid x-service-token and assigns role', async () => {
    const res = await fetch(`${baseUrl}/admin/roles/assign`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': config.iamServiceAuthToken,
      },
      body: JSON.stringify({
        userId: 'applicant-1',
        role: 'member',
        scopeType: 'committee',
        scopeId: '11111111-1111-4111-8111-111111111111',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.userId, 'applicant-1');
    assert.equal(body.role, 'member');
  });

  describe('3-Step Forgot Password & OTP Flow', () => {
    let capturedOtp = null;
    let resetToken = null;

    test('Step 1: POST /api/auth/forgot-password/request-otp generates OTP and returns generic success', async () => {
      // Intercept console.log to capture dev OTP
      const originalLog = console.log;
      console.log = (...args) => {
        const text = args.join(' ');
        if (text.includes('[AUTH-DEV] Password Reset OTP for')) {
          const match = text.match(/:\s*(\d{6})/);
          if (match) capturedOtp = match[1];
        }
        originalLog.apply(console, args);
      };

      const res = await fetch(`${baseUrl}/api/auth/forgot-password/request-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'officer@ieee.local' }),
      });

      console.log = originalLog;
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.message.includes('6-digit verification code'));
      assert.ok(capturedOtp, 'OTP was generated and logged');
      assert.equal(capturedOtp.length, 6);
    });

    test('Step 2: POST /api/auth/forgot-password/verify-otp enforces attempt limits and verifies code', async () => {
      // 1. Wrong OTP rejects and decrements remaining attempts
      const wrongRes = await fetch(`${baseUrl}/api/auth/forgot-password/verify-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'officer@ieee.local', otp: '000000' }),
      });
      assert.equal(wrongRes.status, 400);
      const wrongBody = await wrongRes.json();
      assert.ok(wrongBody.error.includes('remaining'));

      // 2. Correct OTP succeeds and returns resetToken
      const correctRes = await fetch(`${baseUrl}/api/auth/forgot-password/verify-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'officer@ieee.local', otp: capturedOtp }),
      });
      assert.equal(correctRes.status, 200);
      const correctBody = await correctRes.json();
      assert.ok(correctBody.resetToken);
      resetToken = correctBody.resetToken;
    });

    test('Step 3: POST /api/auth/forgot-password/reset updates password and allows login', async () => {
      // 1. Rejects short password
      const shortRes = await fetch(`${baseUrl}/api/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword: 'short' }),
      });
      assert.equal(shortRes.status, 400);

      // 2. Accepts valid new password
      const resetRes = await fetch(`${baseUrl}/api/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resetToken,
          newPassword: 'BrandNewOfficerPassword2026!',
          confirmPassword: 'BrandNewOfficerPassword2026!',
        }),
      });
      assert.equal(resetRes.status, 200);
      const resetBody = await resetRes.json();
      assert.ok(resetBody.message.includes('successfully'));

      // 3. Login with new password succeeds
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'officer@ieee.local', password: 'BrandNewOfficerPassword2026!' }),
      });
      assert.equal(loginRes.status, 200);

      // 4. Token cannot be reused (replay protection)
      const reuseRes = await fetch(`${baseUrl}/api/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword: 'AnotherPassword123!' }),
      });
      assert.equal(reuseRes.status, 400);

      // Restore password for officer
      const loginData = await loginRes.json();
      await fetch(`${baseUrl}/api/auth/password`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({
          currentPassword: 'BrandNewOfficerPassword2026!',
          newPassword: 'password123',
          confirmPassword: 'password123',
        }),
      });
    });
  });
});
