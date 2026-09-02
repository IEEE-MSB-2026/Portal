const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IDS,
  closePool,
  createServer,
  getBaseUrl,
  prepareDatabase,
  setupTestEnv,
  signedHeaders,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

test.after(async () => {
  await closePool();
});

test('user profile: invalid UUID returns 400', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = '/core/users/not-a-valid-uuid/profile';
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: IDS.users.memberAi,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'GET',
      headers,
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.message || payload.error || '', /Invalid user ID format/i);
  } finally {
    server.close();
  }
});

test('user profile: non-existent user returns 404', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const nonExistentId = '00000000-0000-4000-8000-000000000000';
    const path = `/core/users/${nonExistentId}/profile`;
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: IDS.users.memberAi,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'GET',
      headers,
    });

    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('user profile: public member view sees profile & committees but omits email/phone', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/users/${IDS.users.memberAi}/profile`;
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: IDS.users.memberWeb,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.web,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'GET',
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.profile);
    assert.equal(payload.profile.id, IDS.users.memberAi);
    assert.equal(payload.profile.name, 'Member AI User');
    assert.ok(Array.isArray(payload.profile.committees));
    assert.ok(payload.profile.committees.length >= 1);
    assert.equal(payload.profile.committees[0].committeeName, 'AI Committee');
    assert.equal(payload.profile.committees[0].roleInCommittee, 'member');
    assert.ok(payload.profile.stats);
    assert.equal(typeof payload.profile.stats.tasksCompleted, 'number');
    assert.equal(typeof payload.profile.stats.assignmentsSubmitted, 'number');

    // Contact details must be omitted for general member
    assert.equal(payload.profile.email, undefined);
    assert.equal(payload.profile.phone, undefined);
    assert.equal(payload.profile.canViewPrivate, false);
  } finally {
    server.close();
  }
});

test('user profile: elevated admin view includes email and private details', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/users/${IDS.users.memberAi}/profile`;
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: IDS.users.admin,
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'GET',
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.profile);
    assert.equal(payload.profile.id, IDS.users.memberAi);
    assert.equal(payload.profile.email, 'member.ai@ieee.local');
    assert.equal(payload.profile.canViewPrivate, true);
  } finally {
    server.close();
  }
});

test('user profile: self view includes email and canViewPrivate=true', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/users/${IDS.users.memberAi}/profile`;
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: IDS.users.memberAi,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'GET',
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.profile);
    assert.equal(payload.profile.id, IDS.users.memberAi);
    assert.equal(payload.profile.email, 'member.ai@ieee.local');
    assert.equal(payload.profile.isSelf, true);
    assert.equal(payload.profile.canViewPrivate, true);
  } finally {
    server.close();
  }
});

test('user profile: PATCH /core/me/profile updates bio, university, faculty, department, socials', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const patchPath = '/core/me/profile';
    const patchHeaders = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: IDS.users.memberAi,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const patchRes = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...patchHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bio: 'Autonomous systems and machine learning enthusiast.',
        university: 'Menoufia University',
        faculty: 'Faculty of Electronic Engineering',
        department: 'Computer Science & Engineering',
        academicYear: 'Third Year',
        phone: '+201001234567',
        socialLinks: {
          github: 'https://github.com/memberai',
          linkedin: 'https://linkedin.com/in/memberai',
          website: 'https://memberai.dev',
        },
      }),
    });

    assert.equal(patchRes.status, 200);
    const patchPayload = await patchRes.json();
    assert.equal(patchPayload.ok, true);
    assert.equal(patchPayload.profile.bio, 'Autonomous systems and machine learning enthusiast.');
    assert.equal(patchPayload.profile.university, 'Menoufia University');
    assert.equal(patchPayload.profile.faculty, 'Faculty of Electronic Engineering');
    assert.equal(patchPayload.profile.department, 'Computer Science & Engineering');
    assert.equal(patchPayload.profile.academicYear, 'Third Year');
    assert.equal(patchPayload.profile.socialLinks.github, 'https://github.com/memberai');

    // Verify that GET reflects the changes
    const getPath = `/core/users/${IDS.users.memberAi}/profile`;
    const getHeaders = signedHeaders({
      method: 'GET',
      path: getPath,
      userId: IDS.users.memberAi,
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const getRes = await fetch(`${getBaseUrl(server)}${getPath}`, {
      method: 'GET',
      headers: getHeaders,
    });

    assert.equal(getRes.status, 200);
    const getPayload = await getRes.json();
    assert.equal(getPayload.profile.bio, 'Autonomous systems and machine learning enthusiast.');
    assert.equal(getPayload.profile.university, 'Menoufia University');
    assert.equal(getPayload.profile.faculty, 'Faculty of Electronic Engineering');
    assert.equal(getPayload.profile.department, 'Computer Science & Engineering');
    assert.equal(getPayload.profile.academicYear, 'Third Year');
    assert.equal(getPayload.profile.socialLinks.github, 'https://github.com/memberai');
    assert.equal(getPayload.profile.socialLinks.linkedin, 'https://linkedin.com/in/memberai');
  } finally {
    server.close();
  }
});
