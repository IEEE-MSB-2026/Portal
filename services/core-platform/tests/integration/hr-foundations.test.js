const test = require('node:test');
const assert = require('node:assert/strict');

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
const app = require('../../src/app');

function isoHoursFromNow(hours) {
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
}

async function createCampaign({
  server,
  userId,
  userEmail,
  userRole,
  scopeType,
  scopeId,
  body,
}) {
  const path = '/core/hr/campaigns';
  const headers = signedHeaders({
    method: 'POST',
    path,
    userId,
    userEmail,
    userRole,
    scopeType,
    scopeId,
  });

  const response = await fetch(`${getBaseUrl(server)}${path}`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  return { response, payload };
}

async function submitApplication({
  server,
  userId,
  userEmail,
  userRole,
  scopeType,
  scopeId,
  body,
}) {
  const path = '/core/hr/applications';
  const headers = signedHeaders({
    method: 'POST',
    path,
    userId,
    userEmail,
    userRole,
    scopeType,
    scopeId,
  });

  const response = await fetch(`${getBaseUrl(server)}${path}`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('hr campaigns: lead in HR committee can create campaign', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const { response, payload } = await createCampaign({
      server,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
      body: {
        committeeId: IDS.committees.hr,
        title: 'HR Spring Recruitment',
        description: 'Spring cycle 2026',
        opensAt: isoHoursFromNow(-1),
        closesAt: isoHoursFromNow(24),
        status: 'draft',
        formSchema: { fields: [{ name: 'motivation', type: 'text' }] },
      },
    });

    assert.equal(response.status, 201);
    assert.equal(payload.campaign.committeeId, IDS.committees.hr);
    assert.equal(payload.campaign.title, 'HR Spring Recruitment');
    assert.equal(payload.campaign.status, 'draft');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr campaigns: cannot open campaign outside configured window', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Closed Window Campaign',
        opensAt: isoHoursFromNow(-24),
        closesAt: isoHoursFromNow(-1),
        status: 'draft',
        formSchema: { fields: [] },
      },
    });

    assert.equal(createResult.response.status, 201);
    const campaignId = createResult.payload.campaign.id;
    const patchPath = `/core/hr/campaigns/${campaignId}/status`;
    const patchHeaders = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
    });

    const response = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...patchHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'open' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Cannot open campaign outside its configured time window');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr applications: submit while open succeeds and duplicate is blocked', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Open Campaign',
        opensAt: isoHoursFromNow(-2),
        closesAt: isoHoursFromNow(48),
        status: 'open',
        formSchema: { fields: [{ name: 'portfolio', type: 'url' }] },
      },
    });

    const campaignId = createResult.payload.campaign.id;
    const first = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId,
        answers: { portfolio: 'https://example.com/member-ai' },
      },
    });

    assert.equal(first.response.status, 201);
    assert.equal(first.payload.application.currentStage, 'applied');

    const duplicate = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId,
        answers: { portfolio: 'https://example.com/member-ai-duplicate' },
      },
    });

    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.payload.error, 'Application already submitted for this campaign');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr applications: submit while campaign closed is rejected', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Closed Campaign',
        opensAt: isoHoursFromNow(-2),
        closesAt: isoHoursFromNow(48),
        status: 'closed',
        formSchema: { fields: [] },
      },
    });

    const { response, payload } = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId: createResult.payload.campaign.id,
        answers: { why: 'I want to join' },
      },
    });

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Campaign is not open for applications');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr stage updates: valid transition succeeds and logs audit row', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Stage Campaign',
        opensAt: isoHoursFromNow(-1),
        closesAt: isoHoursFromNow(24),
        status: 'open',
        formSchema: { fields: [] },
      },
    });

    const submission = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId: createResult.payload.campaign.id,
        answers: { question: 'answer' },
      },
    });

    const applicationId = submission.payload.application.id;
    const stagePath = `/core/hr/applications/${applicationId}/stage`;
    const stageHeaders = signedHeaders({
      method: 'PATCH',
      path: stagePath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
    });

    const response = await fetch(`${getBaseUrl(server)}${stagePath}`, {
      method: 'PATCH',
      headers: {
        ...stageHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stage: 'screening', score: 88, notes: 'Solid profile' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.application.currentStage, 'screening');

    const logResult = await query(
      `
        SELECT COUNT(*)::int AS c
        FROM hr_application_stage_log
        WHERE application_id = $1
      `,
      [applicationId]
    );
    assert.equal(logResult.rows[0].c, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr stage updates: invalid transition is rejected', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Invalid Transition Campaign',
        opensAt: isoHoursFromNow(-1),
        closesAt: isoHoursFromNow(24),
        status: 'open',
        formSchema: { fields: [] },
      },
    });

    const submission = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId: createResult.payload.campaign.id,
        answers: { question: 'answer' },
      },
    });

    const applicationId = submission.payload.application.id;
    const stagePath = `/core/hr/applications/${applicationId}/stage`;
    const stageHeaders = signedHeaders({
      method: 'PATCH',
      path: stagePath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
    });

    const response = await fetch(`${getBaseUrl(server)}${stagePath}`, {
      method: 'PATCH',
      headers: {
        ...stageHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stage: 'applied' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Invalid application stage transition');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr reject: authorized reject succeeds and unauthorized reject is blocked', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Reject Campaign',
        opensAt: isoHoursFromNow(-1),
        closesAt: isoHoursFromNow(24),
        status: 'open',
        formSchema: { fields: [] },
      },
    });

    const submission = await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId: createResult.payload.campaign.id,
        answers: { question: 'answer' },
      },
    });

    const applicationId = submission.payload.application.id;
    const rejectPath = `/core/hr/applications/${applicationId}/reject`;
    const memberHeaders = signedHeaders({
      method: 'POST',
      path: rejectPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const forbidden = await fetch(`${getBaseUrl(server)}${rejectPath}`, {
      method: 'POST',
      headers: {
        ...memberHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'No permission' }),
    });
    assert.equal(forbidden.status, 403);

    const officerHeaders = signedHeaders({
      method: 'POST',
      path: rejectPath,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
    });

    const accepted = await fetch(`${getBaseUrl(server)}${rejectPath}`, {
      method: 'POST',
      headers: {
        ...officerHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'Insufficient fit this cycle' }),
    });
    const acceptedPayload = await accepted.json();

    assert.equal(accepted.status, 200);
    assert.equal(acceptedPayload.application.currentStage, 'rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authorization regression: global officer can manage HR, global member cannot bypass committee routes', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        committeeId: IDS.committees.hr,
        title: 'Access Campaign',
        opensAt: isoHoursFromNow(-1),
        closesAt: isoHoursFromNow(24),
        status: 'open',
        formSchema: { fields: [] },
      },
    });
    assert.equal(createResult.response.status, 201);

    const listPath = '/core/hr/applications';
    const officerListHeaders = signedHeaders({
      method: 'GET',
      path: listPath,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
    });

    const officerList = await fetch(`${getBaseUrl(server)}${listPath}`, {
      method: 'GET',
      headers: officerListHeaders,
    });
    assert.equal(officerList.status, 200);

    const globalMemberHeaders = signedHeaders({
      method: 'GET',
      path: listPath,
      userId: 'member-global-1',
      userEmail: 'member.global@ieee.local',
      userRole: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    const globalMemberList = await fetch(`${getBaseUrl(server)}${listPath}`, {
      method: 'GET',
      headers: globalMemberHeaders,
    });
    assert.equal(globalMemberList.status, 403);

    const committeePath = `/core/committees/${IDS.committees.ai}/resources`;
    const globalMemberCommitteeHeaders = signedHeaders({
      method: 'GET',
      path: committeePath,
      userId: 'member-global-1',
      userEmail: 'member.global@ieee.local',
      userRole: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    const forbiddenCommitteeRead = await fetch(`${getBaseUrl(server)}${committeePath}`, {
      method: 'GET',
      headers: globalMemberCommitteeHeaders,
    });
    assert.equal(forbiddenCommitteeRead.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('my applications: member can list own submitted applications via GET /core/me/applications', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const createResult = await createCampaign({
      server,
      userId: 'officer-1',
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
      body: {
        title: 'Spring Member Drive',
        committeeIds: [IDS.committees.web],
        description: 'Join Web committee',
        opensAt: '2026-01-01T00:00:00.000Z',
        closesAt: '2026-12-31T00:00:00.000Z',
        status: 'open',
      },
    });

    await submitApplication({
      server,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
      body: {
        campaignId: createResult.payload.campaign.id,
        answers: { portfolio: 'https://github.com/member' },
      },
    });

    const myAppsPath = '/core/me/applications';
    const myAppsHeaders = signedHeaders({
      method: 'GET',
      path: myAppsPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${myAppsPath}`, {
      method: 'GET',
      headers: myAppsHeaders,
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.applications));
    assert.equal(payload.applications.length, 1);
    assert.equal(payload.applications[0].campaignTitle, 'Spring Member Drive');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
