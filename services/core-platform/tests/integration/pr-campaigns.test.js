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

function createCaptureServer({ statusCode = 202, expectedPath = '/email/send' } = {}) {
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

async function requestJson(server, { method, path: routePath, headers, body }) {
  const response = await fetch(`${getBaseUrl(server)}${routePath}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

function signedCoreHeaders({ method, path: routePath, actor }) {
  return signedHeaders({
    method,
    path: routePath,
    userId: actor.userId,
    userEmail: actor.userEmail,
    userRole: actor.userRole,
    scopeType: actor.scopeType,
    scopeId: actor.scopeId,
  });
}

async function createCampaign({ server, actor, body }) {
  const routePath = '/core/pr/campaigns';
  const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor });
  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
    body,
  });
}

async function sendCampaign({ server, actor, campaignId }) {
  const routePath = `/core/pr/campaigns/${campaignId}/send`;
  const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor });
  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
  });
}

async function getDelivery({ server, actor, campaignId }) {
  const routePath = `/core/pr/campaigns/${campaignId}/delivery`;
  const headers = signedCoreHeaders({ method: 'GET', path: routePath, actor });
  return requestJson(server, {
    method: 'GET',
    path: routePath,
    headers,
  });
}

const ACTORS = {
  leadAi: {
    userId: 'lead-ai-1',
    userEmail: 'lead.ai@ieee.local',
    userRole: 'lead',
    scopeType: 'committee',
    scopeId: IDS.committees.ai,
  },
  publisherGlobal: {
    userId: 'publisher-1',
    userEmail: 'publisher@ieee.local',
    userRole: 'publisher',
    scopeType: 'global',
    scopeId: 'global',
  },
  officerGlobal: {
    userId: 'officer-1',
    userEmail: 'officer@ieee.local',
    userRole: 'officer',
    scopeType: 'global',
    scopeId: 'global',
  },
};

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
  clearCoreModuleCache();
});

test('pr campaigns: create and send succeeds for publisher with delivery counters', async () => {
  await prepareDatabase();
  const emailServer = await startCaptureServer({ statusCode: 202 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'campaign-token',
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
        PR_CAMPAIGN_MAX_RECIPIENTS: '10',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const created = await createCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            body: {
              committeeId: IDS.committees.ai,
              title: 'AI Weekly Digest',
              subject: 'AI Weekly Digest - Week 1',
              body: 'Updates from the AI committee.',
              segmentType: 'committee_members',
              status: 'draft',
            },
          });
          assert.equal(created.response.status, 201);

          const campaignId = created.payload.campaign.id;
          const sent = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId,
          });

          assert.equal(sent.response.status, 200);
          assert.equal(sent.payload.campaign.status, 'sent');
          assert.equal(sent.payload.dispatch.idempotent, false);
          assert.equal(sent.payload.dispatch.sentCount, 2);
          assert.equal(emailServer.requests.length, 2);

          for (const outbound of emailServer.requests) {
            assert.equal(outbound.url, '/email/send');
            assert.equal(outbound.headers['x-service-token'], 'campaign-token');
            assert.equal(outbound.body.eventType, 'core.pr.campaign.dispatched');
            assert.equal(
              String(outbound.body.idempotencyKey).startsWith(`core-pr-campaign:${campaignId}:`),
              true
            );
          }

          const delivery = await getDelivery({
            server,
            actor: ACTORS.leadAi,
            campaignId,
          });

          assert.equal(delivery.response.status, 200);
          assert.equal(delivery.payload.campaign.status, 'sent');
          assert.equal(delivery.payload.delivery.recipientCount, 2);
          assert.equal(delivery.payload.delivery.sentCount, 2);
          assert.equal(delivery.payload.delivery.failedCount, 0);
          assert.equal(delivery.payload.delivery.attempts.length, 1);
          assert.equal(delivery.payload.delivery.attempts[0].status, 'sent');
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('pr campaigns: send is forbidden for non publisher/admin roles', async () => {
  await prepareDatabase();
  const emailServer = await startCaptureServer({ statusCode: 202 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'campaign-token',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const created = await createCampaign({
            server,
            actor: ACTORS.leadAi,
            body: {
              committeeId: IDS.committees.ai,
              title: 'Lead Draft',
              subject: 'Lead Draft',
              body: 'Body',
              segmentType: 'committee_members',
            },
          });
          assert.equal(created.response.status, 201);

          const blocked = await sendCampaign({
            server,
            actor: ACTORS.officerGlobal,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(blocked.response.status, 403);
          assert.equal(emailServer.requests.length, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('pr campaigns: repeated send is idempotent and does not dispatch again', async () => {
  await prepareDatabase();
  const emailServer = await startCaptureServer({ statusCode: 202 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'campaign-token',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const created = await createCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            body: {
              committeeId: IDS.committees.ai,
              title: 'Idempotency Campaign',
              subject: 'Subject',
              body: 'Body',
              segmentType: 'committee_members',
            },
          });
          const campaignId = created.payload.campaign.id;

          const first = await sendCampaign({ server, actor: ACTORS.publisherGlobal, campaignId });
          assert.equal(first.response.status, 200);
          assert.equal(emailServer.requests.length, 2);

          const second = await sendCampaign({ server, actor: ACTORS.publisherGlobal, campaignId });
          assert.equal(second.response.status, 200);
          assert.equal(second.payload.dispatch.idempotent, true);
          assert.equal(emailServer.requests.length, 2);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('pr campaigns: downstream failure marks campaign failed and returns 502', async () => {
  await prepareDatabase();
  const emailServer = await startCaptureServer({ statusCode: 500 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'campaign-token',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const created = await createCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            body: {
              committeeId: IDS.committees.ai,
              title: 'Failure Campaign',
              subject: 'Failure subject',
              body: 'Failure body',
              segmentType: 'committee_members',
            },
          });

          const failed = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });

          assert.equal(failed.response.status, 502);
          assert.equal(failed.payload.error, 'Campaign dispatch failed');
          assert.equal(failed.payload.campaign.status, 'failed');
          assert.equal(emailServer.requests.length, 2);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('pr campaigns: recipient guard blocks oversized segment before dispatch', async () => {
  await prepareDatabase();
  const emailServer = await startCaptureServer({ statusCode: 202 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'campaign-token',
        PR_CAMPAIGN_MAX_RECIPIENTS: '1',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const created = await createCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            body: {
              committeeId: IDS.committees.ai,
              title: 'Guard Campaign',
              subject: 'Guard subject',
              body: 'Guard body',
              segmentType: 'committee_members',
            },
          });

          const blocked = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });

          assert.equal(blocked.response.status, 400);
          assert.equal(blocked.payload.error, 'Campaign exceeds max recipients limit (1)');
          assert.equal(emailServer.requests.length, 0);

          const delivery = await getDelivery({
            server,
            actor: ACTORS.leadAi,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(delivery.response.status, 200);
          assert.equal(delivery.payload.campaign.status, 'draft');
          assert.equal(delivery.payload.delivery.attempts.length, 0);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});
