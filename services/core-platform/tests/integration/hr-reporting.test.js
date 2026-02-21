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

async function startCaptureServer({ expectedPath, statusCode = 200 }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      let body = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = null;
      }

      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });

      res.statusCode = req.url === expectedPath ? statusCode : 404;
      res.setHeader('content-type', 'application/json');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.end('{"status":"ok"}');
      } else {
        res.end('{"error":"failed"}');
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
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

async function createCampaign({ server, title }) {
  const routePath = '/core/hr/campaigns';
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: 'officer-1',
    userEmail: 'officer@ieee.local',
    userRole: 'officer',
    scopeType: 'global',
    scopeId: 'global',
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: {
      committeeId: IDS.committees.hr,
      title,
      opensAt: isoHoursFromNow(-3),
      closesAt: isoHoursFromNow(48),
      status: 'open',
      formSchema: { fields: [] },
    },
  });
}

async function submitApplication({ server, campaignId, user }) {
  const routePath = '/core/hr/applications';
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: user.userId,
    userEmail: user.userEmail,
    userRole: user.userRole,
    scopeType: user.scopeType,
    scopeId: user.scopeId,
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: {
      campaignId,
      answers: { motivation: 'test' },
    },
  });
}

async function setStage({ server, applicationId, stage }) {
  const routePath = `/core/hr/applications/${applicationId}/stage`;
  const headers = signedHeaders({
    method: 'PATCH',
    path: routePath,
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.hr,
  });

  return requestJson(server, {
    method: 'PATCH',
    path: routePath,
    headers,
    body: { stage },
  });
}

async function moveToFinalReview({ server, applicationId }) {
  for (const stage of ['screening', 'interview', 'final_review']) {
    const result = await setStage({ server, applicationId, stage });
    assert.equal(result.response.status, 200);
  }
}

async function acceptApplication({ server, applicationId }) {
  const routePath = `/core/hr/applications/${applicationId}/accept`;
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: 'officer-1',
    userEmail: 'officer@ieee.local',
    userRole: 'officer',
    scopeType: 'global',
    scopeId: 'global',
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: {},
  });
}

async function rejectApplication({ server, applicationId }) {
  const routePath = `/core/hr/applications/${applicationId}/reject`;
  const headers = signedHeaders({
    method: 'POST',
    path: routePath,
    userId: 'officer-1',
    userEmail: 'officer@ieee.local',
    userRole: 'officer',
    scopeType: 'global',
    scopeId: 'global',
  });

  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body: { notes: 'not selected' },
  });
}

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
  clearCoreModuleCache();
});

test('hr reports: pipeline summary includes accepted and rejected counts for scoped committee', async () => {
  await prepareDatabase();
  const iamServer = await startCaptureServer({ expectedPath: '/admin/roles/assign', statusCode: 200 });

  try {
    await withEnv(
      {
        IAM_SERVICE_URL: iamServer.baseUrl,
        IAM_SERVICE_AUTH_TOKEN: 'iam-token',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const campaign = await createCampaign({ server, title: 'report summary campaign' });
          const campaignId = campaign.payload.campaign.id;

          const memberAiSubmission = await submitApplication({
            server,
            campaignId,
            user: {
              userId: 'member-ai-1',
              userEmail: 'member.ai@ieee.local',
              userRole: 'member',
              scopeType: 'committee',
              scopeId: IDS.committees.ai,
            },
          });
          const memberWebSubmission = await submitApplication({
            server,
            campaignId,
            user: {
              userId: 'member-web-1',
              userEmail: 'member.web@ieee.local',
              userRole: 'member',
              scopeType: 'committee',
              scopeId: IDS.committees.web,
            },
          });

          await moveToFinalReview({ server, applicationId: memberAiSubmission.payload.application.id });
          const accepted = await acceptApplication({
            server,
            applicationId: memberAiSubmission.payload.application.id,
          });
          assert.equal(accepted.response.status, 200);

          const rejected = await rejectApplication({
            server,
            applicationId: memberWebSubmission.payload.application.id,
          });
          assert.equal(rejected.response.status, 200);

          const summaryPath = `/core/hr/reports/pipeline-summary?committeeId=${IDS.committees.hr}`;
          const summaryHeaders = signedHeaders({
            method: 'GET',
            path: '/core/hr/reports/pipeline-summary',
            userId: 'officer-1',
            userEmail: 'officer@ieee.local',
            userRole: 'officer',
            scopeType: 'global',
            scopeId: 'global',
          });

          const summary = await requestJson(server, {
            method: 'GET',
            path: summaryPath,
            headers: summaryHeaders,
          });

          assert.equal(summary.response.status, 200);
          assert.equal(summary.payload.totals.applications, 2);
          assert.equal(summary.payload.stages.accepted, 1);
          assert.equal(summary.payload.stages.rejected, 1);
          assert.equal(summary.payload.stages.finalReview, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await iamServer.close();
  }
});

test('hr reports: timeline supports day/week bucketing and scoped authorization', async () => {
  await prepareDatabase();

  const app = loadFreshApp();
  const server = await createServer(app);

  try {
    const campaign = await createCampaign({ server, title: 'timeline campaign' });
    const submission = await submitApplication({
      server,
      campaignId: campaign.payload.campaign.id,
      user: {
        userId: 'member-ai-1',
        userEmail: 'member.ai@ieee.local',
        userRole: 'member',
        scopeType: 'committee',
        scopeId: IDS.committees.ai,
      },
    });

    await moveToFinalReview({ server, applicationId: submission.payload.application.id });

    const timelinePath = `/core/hr/reports/pipeline-timeline?committeeId=${IDS.committees.hr}&granularity=day`;
    const timelineHeaders = signedHeaders({
      method: 'GET',
      path: '/core/hr/reports/pipeline-timeline',
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.hr,
    });

    const timeline = await requestJson(server, {
      method: 'GET',
      path: timelinePath,
      headers: timelineHeaders,
    });

    assert.equal(timeline.response.status, 200);
    assert.equal(timeline.payload.granularity, 'day');
    assert.equal(Array.isArray(timeline.payload.points), true);
    assert.equal(timeline.payload.points.length >= 1, true);
    assert.equal(timeline.payload.points[0].totalTransitions >= 1, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hr reports: unscoped global member cannot access report endpoints', async () => {
  await prepareDatabase();

  const app = loadFreshApp();
  const server = await createServer(app);

  try {
    const path = '/core/hr/reports/pipeline-summary';
    const headers = signedHeaders({
      method: 'GET',
      path,
      userId: 'member-global-1',
      userEmail: 'member.global@ieee.local',
      userRole: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    const forbidden = await requestJson(server, {
      method: 'GET',
      path,
      headers,
    });

    assert.equal(forbidden.response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
