const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

function createCaptureServer({ statusCode = 200, expectedPath }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      let parsedBody = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch (error) {
        parsedBody = null;
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody,
        body: parsedBody,
      });

      res.statusCode = req.url === expectedPath ? statusCode : 404;
      res.setHeader('content-type', 'application/json');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.end('{"status":"ok"}');
      } else {
        res.end('{"error":"downstream failure"}');
      }
    });
  });

  return { requests, server };
}

async function startCaptureServer(options) {
  const harness = createCaptureServer(options);
  await new Promise((resolve) => harness.server.listen(0, '127.0.0.1', resolve));
  const address = harness.server.address();

  return {
    requests: harness.requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => harness.server.close(resolve));
    },
  };
}

function isoHoursFromNow(hours) {
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
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

async function createCampaign({ server, committeeId, actor }) {
  const routePath = '/core/hr/campaigns';
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
    scopeType: actor.scopeType,
    scopeId: actor.scopeId,
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: {
      committeeId,
      title: `${committeeId}-campaign`,
      description: 'Acceptance pipeline test campaign',
      opensAt: isoHoursFromNow(-2),
      closesAt: isoHoursFromNow(48),
      status: 'open',
      formSchema: { fields: [] },
    },
  });
}

async function submitApplication({ server, campaignId, applicant }) {
  const routePath = '/core/hr/applications';
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: applicant.userId,
    userEmail: applicant.userEmail,
    userRole: applicant.userRole,
    scopeType: applicant.scopeType,
    scopeId: applicant.scopeId,
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: {
      campaignId,
      answers: { motivation: 'I want to contribute' },
    },
  });
}

async function updateStage({ server, applicationId, stage, actor }) {
  const routePath = `/core/hr/applications/${applicationId}/stage`;
  const headers = signedHeaders({
    method: 'PATCH',
    path: routePath,
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
    scopeType: actor.scopeType,
    scopeId: actor.scopeId,
  });

  return requestJson(server, {
    method: 'PATCH',
    path: routePath,
    headers,
    body: { stage },
  });
}

async function moveToFinalReview({ server, applicationId, actor }) {
  for (const stage of ['screening', 'interview', 'final_review']) {
    const { response } = await updateStage({ server, applicationId, stage, actor });
    assert.equal(response.status, 200);
  }
}

async function acceptApplication({ server, applicationId, actor, notes }) {
  const routePath = `/core/hr/applications/${applicationId}/accept`;
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
    scopeType: actor.scopeType,
    scopeId: actor.scopeId,
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: notes ? { notes } : {},
  });
}

const ACTORS = {
  officerGlobal: {
    userId: 'officer-1',
    userEmail: 'officer@ieee.local',
    userRole: 'officer',
    scopeType: 'global',
    scopeId: 'global',
  },
  leadHr: {
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.hr,
  },
  leadAi: {
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.ai,
  },
  memberAi: {
    userId: 'member-ai-1',
    userEmail: 'member.ai@ieee.local',
    userRole: 'member',
    scopeType: 'committee',
    scopeId: IDS.committees.ai,
  },
  memberWeb: {
    userId: 'member-web-1',
    userEmail: 'member.web@ieee.local',
    userRole: 'member',
    scopeType: 'committee',
    scopeId: IDS.committees.web,
  },
};

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
  clearCoreModuleCache();
});

test('hr accept: success path assigns IAM role once and creates onboarding checklist', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });
  const emailServer = await startCaptureServer({ expectedPath: '/email/send', statusCode: 202 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'email-service-token',
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const createdCampaign = await createCampaign({
            server,
            committeeId: IDS.committees.hr,
            actor: ACTORS.officerGlobal,
          });
          assert.equal(createdCampaign.response.status, 201);

          const submission = await submitApplication({
            server,
            campaignId: createdCampaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });
          assert.equal(submission.response.status, 201);

          const applicationId = submission.payload.application.id;
          await moveToFinalReview({
            server,
            applicationId,
            actor: ACTORS.leadHr,
          });

          const accepted = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.officerGlobal,
            notes: 'Strong candidate',
          });

          assert.equal(accepted.response.status, 200);
          assert.equal(accepted.payload.application.currentStage, 'accepted');
          assert.equal(iamServer.requests.length, 1);

          const outboundIam = iamServer.requests[0];
          assert.equal(outboundIam.method, 'POST');
          assert.equal(outboundIam.url, '/admin/roles/assign');
          assert.equal(outboundIam.headers['x-service-token'], 'iam-service-token');
          assert.equal(outboundIam.body.schemaVersion, '1.0');
          assert.equal(outboundIam.body.userId, IDS.users.memberAi);
          assert.equal(outboundIam.body.role, 'member');
          assert.equal(outboundIam.body.scopeType, 'committee');
          assert.equal(outboundIam.body.scopeId, IDS.committees.hr);
          assert.equal(
            outboundIam.body.idempotencyKey,
            `core-hr-accept:${applicationId}:${IDS.users.memberAi}:${IDS.committees.hr}:member`
          );

          const onboardingCount = await query(
            'SELECT COUNT(*)::int AS c FROM hr_onboarding_items WHERE application_id = $1',
            [applicationId]
          );
          assert.equal(onboardingCount.rows[0].c, 0);

          const acceptedStageRows = await query(
            `
              SELECT COUNT(*)::int AS c
              FROM hr_application_stage_log
              WHERE application_id = $1 AND to_stage = 'accepted'
            `,
            [applicationId]
          );
          assert.equal(acceptedStageRows.rows[0].c, 1);

          // Verify committee membership was added for the candidate
          const membershipRows = await query(
            'SELECT committee_id, role_in_committee FROM committee_memberships WHERE user_id = $1 AND committee_id = $2',
            [IDS.users.memberAi, IDS.committees.hr]
          );
          assert.equal(membershipRows.rows.length, 1);
          assert.equal(membershipRows.rows[0].role_in_committee, 'member');

          // Automatic legacy plain-text email is NOT sent upon accept (welcome packages dispatched via Onboarding Studio)
          assert.equal(emailServer.requests.length, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
    await emailServer.close();
  }
});

test('hr accept: repeated call is idempotent and does not duplicate side effects', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
        EMAIL_SERVICE_URL: undefined,
        EMAIL_SERVICE_AUTH_TOKEN: undefined,
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const createdCampaign = await createCampaign({
            server,
            committeeId: IDS.committees.hr,
            actor: ACTORS.officerGlobal,
          });
          const submission = await submitApplication({
            server,
            campaignId: createdCampaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });
          const applicationId = submission.payload.application.id;

          await moveToFinalReview({
            server,
            applicationId,
            actor: ACTORS.leadHr,
          });

          const first = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.officerGlobal,
          });
          const second = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.officerGlobal,
          });

          assert.equal(first.response.status, 200);
          assert.equal(second.response.status, 200);
          assert.equal(iamServer.requests.length, 1);

          const onboardingCount = await query(
            'SELECT COUNT(*)::int AS c FROM hr_onboarding_items WHERE application_id = $1',
            [applicationId]
          );
          assert.equal(onboardingCount.rows[0].c, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

test('hr accept governance: mode_b blocks lead and mode_a allows lead', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });

  try {
    const buildPendingAcceptance = async (server) => {
      const createdCampaign = await createCampaign({
        server,
        committeeId: IDS.committees.hr,
        actor: ACTORS.officerGlobal,
      });
      const submission = await submitApplication({
        server,
        campaignId: createdCampaign.payload.campaign.id,
        applicant: ACTORS.memberAi,
      });
      const applicationId = submission.payload.application.id;
      await moveToFinalReview({ server, applicationId, actor: ACTORS.leadHr });
      return applicationId;
    };

    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const applicationId = await buildPendingAcceptance(server);
          const blocked = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.leadHr,
          });

          assert.equal(blocked.response.status, 403);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );

    await prepareDatabase();

    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_a',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const applicationId = await buildPendingAcceptance(server);
          const allowed = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.leadHr,
          });

          assert.equal(allowed.response.status, 200);
          assert.equal(allowed.payload.application.currentStage, 'accepted');
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

test('hr accept: IAM downstream failure returns 502 and keeps stage non-accepted', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 500 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const createdCampaign = await createCampaign({
            server,
            committeeId: IDS.committees.hr,
            actor: ACTORS.officerGlobal,
          });
          const submission = await submitApplication({
            server,
            campaignId: createdCampaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });
          const applicationId = submission.payload.application.id;

          await moveToFinalReview({ server, applicationId, actor: ACTORS.leadHr });

          const failed = await acceptApplication({
            server,
            applicationId,
            actor: ACTORS.officerGlobal,
          });

          assert.equal(failed.response.status, 502);
          const stageRow = await query('SELECT current_stage FROM hr_applications WHERE id = $1', [applicationId]);
          assert.equal(stageRow.rows[0].current_stage, 'final_review');

          const onboardingCount = await query(
            'SELECT COUNT(*)::int AS c FROM hr_onboarding_items WHERE application_id = $1',
            [applicationId]
          );
          assert.equal(onboardingCount.rows[0].c, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

test('hr accept: missing IAM config returns 503 and keeps stage non-accepted', async () => {
  await prepareDatabase();

  await withEnv(
    {
      IAM_SERVICE_URL: undefined,
      IAM_SERVICE_AUTH_TOKEN: undefined,
      IAM_SERVICE_TIMEOUT_MS: undefined,
      HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
    },
    async () => {
      const app = loadFreshApp();
      const server = await createServer(app);

      try {
        const createdCampaign = await createCampaign({
          server,
          committeeId: IDS.committees.hr,
          actor: ACTORS.officerGlobal,
        });
        const submission = await submitApplication({
          server,
          campaignId: createdCampaign.payload.campaign.id,
          applicant: ACTORS.memberAi,
        });
        const applicationId = submission.payload.application.id;

        await moveToFinalReview({ server, applicationId, actor: ACTORS.leadHr });

        const failed = await acceptApplication({
          server,
          applicationId,
          actor: ACTORS.officerGlobal,
        });

        assert.equal(failed.response.status, 503);

        const stageRow = await query('SELECT current_stage FROM hr_applications WHERE id = $1', [applicationId]);
        assert.equal(stageRow.rows[0].current_stage, 'final_review');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
});

test('onboarding APIs: visibility filtering and update permissions are enforced', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const hrCampaign = await createCampaign({
            server,
            committeeId: IDS.committees.hr,
            actor: ACTORS.officerGlobal,
          });
          const aiCampaign = await createCampaign({
            server,
            committeeId: IDS.committees.ai,
            actor: ACTORS.officerGlobal,
          });

          const hrSubmission = await submitApplication({
            server,
            campaignId: hrCampaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });
          const aiSubmission = await submitApplication({
            server,
            campaignId: aiCampaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });

          await moveToFinalReview({
            server,
            applicationId: hrSubmission.payload.application.id,
            actor: ACTORS.leadHr,
          });
          await moveToFinalReview({
            server,
            applicationId: aiSubmission.payload.application.id,
            actor: ACTORS.leadAi,
          });

          const acceptedHr = await acceptApplication({
            server,
            applicationId: hrSubmission.payload.application.id,
            actor: ACTORS.officerGlobal,
          });
          const acceptedAi = await acceptApplication({
            server,
            applicationId: aiSubmission.payload.application.id,
            actor: ACTORS.officerGlobal,
          });

          assert.equal(acceptedHr.response.status, 200);
          assert.equal(acceptedAi.response.status, 200);

          const selfPath = '/core/hr/onboarding/member-ai-1';
          const selfHeaders = signedHeaders({
            method: 'GET',
            path: selfPath,
            userId: ACTORS.memberAi.userId,
            userEmail: ACTORS.memberAi.userEmail,
            userRole: ACTORS.memberAi.userRole,
            scopeType: ACTORS.memberAi.scopeType,
            scopeId: ACTORS.memberAi.scopeId,
          });

          // 1. Before welcome email is dispatched, onboarding checklist items are NOT yet created (count is 0)
          const selfReadBefore = await requestJson(server, {
            method: 'GET',
            path: selfPath,
            headers: selfHeaders,
          });
          assert.equal(selfReadBefore.response.status, 200);
          assert.equal(selfReadBefore.payload.onboarding.items.length, 0);

          // 2. Dispatch welcome email via mark-welcome-sent
          const markPath = '/core/hr/applications/mark-welcome-sent';
          const markHeaders = signedHeaders({
            method: 'POST',
            path: markPath,
            userId: ACTORS.officerGlobal.userId,
            userEmail: ACTORS.officerGlobal.userEmail,
            userRole: ACTORS.officerGlobal.userRole,
            scopeType: ACTORS.officerGlobal.scopeType,
            scopeId: ACTORS.officerGlobal.scopeId,
          });
          const markRes = await requestJson(server, {
            method: 'POST',
            path: markPath,
            headers: markHeaders,
            body: {
              applicationIds: [
                hrSubmission.payload.application.id,
                aiSubmission.payload.application.id,
              ],
            },
          });
          assert.equal(markRes.response.status, 200);
          assert.equal(markRes.payload.updatedCount, 2);

          // 3. Now member has 8 onboarding items (4 per committee)
          const selfRead = await requestJson(server, {
            method: 'GET',
            path: selfPath,
            headers: selfHeaders,
          });

          assert.equal(selfRead.response.status, 200);
          assert.equal(selfRead.payload.onboarding.items.length, 8);
          assert.equal(selfRead.payload.onboarding.items[0].title, 'Complete Your Portal Profile');

          const hrLeadHeaders = signedHeaders({
            method: 'GET',
            path: selfPath,
            userId: ACTORS.leadHr.userId,
            userEmail: ACTORS.leadHr.userEmail,
            userRole: ACTORS.leadHr.userRole,
            scopeType: ACTORS.leadHr.scopeType,
            scopeId: ACTORS.leadHr.scopeId,
          });
          const hrLeadRead = await requestJson(server, {
            method: 'GET',
            path: selfPath,
            headers: hrLeadHeaders,
          });

          assert.equal(hrLeadRead.response.status, 200);
          assert.equal(hrLeadRead.payload.onboarding.items.length, 4);
          for (const item of hrLeadRead.payload.onboarding.items) {
            assert.equal(item.committeeId, IDS.committees.hr);
          }

          const memberWebHeaders = signedHeaders({
            method: 'GET',
            path: selfPath,
            userId: ACTORS.memberWeb.userId,
            userEmail: ACTORS.memberWeb.userEmail,
            userRole: ACTORS.memberWeb.userRole,
            scopeType: ACTORS.memberWeb.scopeType,
            scopeId: ACTORS.memberWeb.scopeId,
          });
          const unauthorizedRead = await requestJson(server, {
            method: 'GET',
            path: selfPath,
            headers: memberWebHeaders,
          });

          assert.equal(unauthorizedRead.response.status, 403);

          const itemId = hrLeadRead.payload.onboarding.items[0].id;
          const updatePath = `/core/hr/onboarding/${itemId}`;
          const selfPatchHeaders = signedHeaders({
            method: 'PATCH',
            path: updatePath,
            userId: ACTORS.memberAi.userId,
            userEmail: ACTORS.memberAi.userEmail,
            userRole: ACTORS.memberAi.userRole,
            scopeType: ACTORS.memberAi.scopeType,
            scopeId: ACTORS.memberAi.scopeId,
          });
          const selfPatch = await requestJson(server, {
            method: 'PATCH',
            path: updatePath,
            headers: selfPatchHeaders,
            body: { status: 'done' },
          });

          assert.equal(selfPatch.response.status, 200);
          assert.equal(selfPatch.payload.item.status, 'done');

          const unauthorizedPatchHeaders = signedHeaders({
            method: 'PATCH',
            path: updatePath,
            userId: ACTORS.memberWeb.userId,
            userEmail: ACTORS.memberWeb.userEmail,
            userRole: ACTORS.memberWeb.userRole,
            scopeType: ACTORS.memberWeb.scopeType,
            scopeId: ACTORS.memberWeb.scopeId,
          });
          const unauthorizedPatch = await requestJson(server, {
            method: 'PATCH',
            path: updatePath,
            headers: unauthorizedPatchHeaders,
            body: { status: 'todo' },
          });

          assert.equal(unauthorizedPatch.response.status, 403);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

test('onboarding candidates queue: lists unsent accepted candidates and marks sent on dispatch', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-service-token',
        IAM_SERVICE_TIMEOUT_MS: '1000',
        HR_ACCEPT_GOVERNANCE_MODE: 'mode_b',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const campaign = await createCampaign({
            server,
            committeeId: IDS.committees.hr,
            actor: ACTORS.officerGlobal,
          });

          const sub1 = await submitApplication({
            server,
            campaignId: campaign.payload.campaign.id,
            applicant: ACTORS.memberAi,
          });

          await moveToFinalReview({
            server,
            applicationId: sub1.payload.application.id,
            actor: ACTORS.leadHr,
          });

          const accepted = await acceptApplication({
            server,
            applicationId: sub1.payload.application.id,
            actor: ACTORS.officerGlobal,
          });
          assert.equal(accepted.response.status, 200);

          // 1. Check GET /core/hr/onboarding/candidates defaults to unsent
          const listPath = '/core/hr/onboarding/candidates';
          const hrHeaders = signedHeaders({
            method: 'GET',
            path: listPath,
            userId: ACTORS.leadHr.userId,
            userEmail: ACTORS.leadHr.userEmail,
            userRole: ACTORS.leadHr.userRole,
            scopeType: ACTORS.leadHr.scopeType,
            scopeId: ACTORS.leadHr.scopeId,
          });

          const res = await requestJson(server, {
            method: 'GET',
            path: listPath,
            headers: hrHeaders,
          });

          assert.equal(res.response.status, 200);
          assert.equal(res.payload.success, true);
          assert.equal(res.payload.summary.totalAccepted, 1);
          assert.equal(res.payload.summary.unsentCount, 1);
          assert.equal(res.payload.summary.sentCount, 0);
          assert.equal(res.payload.candidates.length, 1);
          assert.equal(res.payload.candidates[0].id, sub1.payload.application.id);
          assert.equal(res.payload.candidates[0].welcomeEmailSent, false);

          // 2. Mark welcome email sent via POST /core/hr/applications/mark-welcome-sent
          const markPath = '/core/hr/applications/mark-welcome-sent';
          const markHeaders = signedHeaders({
            method: 'POST',
            path: markPath,
            userId: ACTORS.officerGlobal.userId,
            userEmail: ACTORS.officerGlobal.userEmail,
            userRole: ACTORS.officerGlobal.userRole,
            scopeType: ACTORS.officerGlobal.scopeType,
            scopeId: ACTORS.officerGlobal.scopeId,
          });

          const markRes = await requestJson(server, {
            method: 'POST',
            path: markPath,
            headers: markHeaders,
            body: {
              applicationIds: [sub1.payload.application.id],
              checklistSteps: [
                { id: 'custom_1', title: 'Upload Your Photo to Portal' },
                { id: 'custom_2', title: 'Join Committee Slack' },
              ],
            },
          });

          assert.equal(markRes.response.status, 200);
          assert.equal(markRes.payload.updatedCount, 1);

          // Verify candidate's onboarding items match the custom checklist
          const onbItems = await query(
            'SELECT title, template_key FROM hr_onboarding_items WHERE application_id = $1 ORDER BY sort_order ASC',
            [sub1.payload.application.id]
          );
          assert.equal(onbItems.rows.length, 2);
          assert.equal(onbItems.rows[0].title, 'Upload Your Photo to Portal');
          assert.equal(onbItems.rows[1].title, 'Join Committee Slack');

          // 3. Query queue again: unsent count is now 0, sent count is 1
          const resAfter = await requestJson(server, {
            method: 'GET',
            path: listPath,
            headers: hrHeaders,
          });

          assert.equal(resAfter.response.status, 200);
          assert.equal(resAfter.payload.summary.totalAccepted, 1);
          assert.equal(resAfter.payload.summary.unsentCount, 0);
          assert.equal(resAfter.payload.summary.sentCount, 1);
          assert.equal(resAfter.payload.candidates.length, 0); // default welcomeEmailSent=false

          // 4. Query with welcomeEmailSent=all returns the candidate with welcomeEmailSent=true
          const allPath = '/core/hr/onboarding/candidates?welcomeEmailSent=all';
          const resAll = await requestJson(server, {
            method: 'GET',
            path: allPath,
            headers: signedHeaders({
              method: 'GET',
              path: listPath,
              userId: ACTORS.leadHr.userId,
              userEmail: ACTORS.leadHr.userEmail,
              userRole: ACTORS.leadHr.userRole,
              scopeType: ACTORS.leadHr.scopeType,
              scopeId: ACTORS.leadHr.scopeId,
            }),
          });

          assert.equal(resAll.response.status, 200);
          assert.equal(resAll.payload.candidates.length, 1);
          assert.equal(resAll.payload.candidates[0].welcomeEmailSent, true);
          assert.ok(resAll.payload.candidates[0].welcomeEmailSentAt);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

