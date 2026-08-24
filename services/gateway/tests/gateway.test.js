const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const app = require('../src/index');
const config = require('../src/config');
const { buildCoreGatewayHeaders, buildEventClaimsHeaders } = require('../src/signer');

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
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /health returns status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'portal-gateway');
  });

  test('GET /api/auth/personas returns list of configured personas without passwords', async () => {
    const res = await fetch(`${baseUrl}/api/auth/personas`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.personas));
    assert.ok(body.personas.length >= 7);

    // Assert passwords are not exposed
    body.personas.forEach((p) => {
      assert.equal(p.password, undefined);
      assert.ok(p.id);
      assert.ok(p.email);
      assert.ok(p.role);
    });

    const admin = body.personas.find((p) => p.role === 'admin');
    assert.ok(admin);
    assert.equal(admin.scopeType, 'global');
  });

  test('POST /api/auth/login validates credentials and issues JWT token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ieee.local', password: 'password123' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
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

  test('POST /api/auth/register creates a new user account with token', async () => {
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
    assert.equal(body.user.email, uniqueEmail);
    assert.equal(body.user.scopeType, 'committee');
    assert.equal(body.user.committeeId, '11111111-1111-4111-8111-111111111111');
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
    assert.equal(meBody.user.committeeName, 'AI');
  });

  test('POST /api/auth/switch-context switches active session role and issues new JWT', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lead.ai@ieee.local', password: 'password123' }),
    });
    const { token } = await loginRes.json();

    const switchRes = await fetch(`${baseUrl}/api/auth/switch-context`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        role: 'member',
        scopeType: 'committee',
        committeeId: '33333333-3333-4333-8333-333333333333',
        committeeName: 'PR',
      }),
    });

    assert.equal(switchRes.status, 200);
    const switchBody = await switchRes.json();
    assert.ok(switchBody.token);
    assert.notEqual(switchBody.token, token);
    assert.equal(switchBody.user.role, 'member');
    assert.equal(switchBody.user.committeeName, 'PR');

    const decoded = jwt.verify(switchBody.token, config.jwtSecret);
    assert.equal(decoded.role, 'member');
    assert.equal(decoded.committeeName, 'PR');
  });

  test('Signer: buildCoreGatewayHeaders generates valid HMAC signature headers', () => {
    const headers = buildCoreGatewayHeaders({
      method: 'GET',
      path: '/core/me/dashboard',
      userId: 'user-123',
      email: 'user@ieee.local',
      role: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    assert.ok(headers['x-gateway-signature']);
    assert.ok(headers['x-gateway-timestamp']);
    assert.equal(headers['x-user-id'], 'user-123');
    assert.equal(headers['x-user-role'], 'member');
  });

  test('Signer: buildEventClaimsHeaders generates valid signed claims for Event Register', () => {
    const headers = buildEventClaimsHeaders({
      role: 'scanner',
      scopeType: 'event',
      scopeId: '507f1f77bcf86cd799439011',
    });

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
