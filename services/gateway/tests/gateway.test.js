const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const config = require('../src/config');
const { closePool } = require('../src/db/pool');
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

  test('Refresh Token Rotation: POST /api/auth/refresh rotates token and detects reuse', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lead.ai@ieee.local', password: 'password123' }),
    });
    const { refreshToken: firstRefreshToken } = await loginRes.json();
    assert.ok(firstRefreshToken);

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

    // 2. Replay attack: reusing the first refresh token must trigger reuse detection and return 403
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
});
