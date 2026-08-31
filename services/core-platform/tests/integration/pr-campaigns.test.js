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
    path: routePath.split('?')[0],
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

async function archiveCampaign({ server, actor, campaignId }) {
  const routePath = `/core/pr/campaigns/${campaignId}/archive`;
  const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor });
  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
  });
}

async function unarchiveCampaign({ server, actor, campaignId }) {
  const routePath = `/core/pr/campaigns/${campaignId}/unarchive`;
  const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor });
  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
  });
}

async function duplicateCampaign({ server, actor, campaignId }) {
  const routePath = `/core/pr/campaigns/${campaignId}/duplicate`;
  const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor });
  return requestJson(server, {
    method: 'POST',
    path: routePath,
    headers,
  });
}

async function listCampaigns({ server, actor, query = '' }) {
  const routePath = `/core/pr/campaigns${query ? `?${query}` : ''}`;
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
  memberAi: {
    userId: 'member-ai-1',
    userEmail: 'member.ai@ieee.local',
    userRole: 'member',
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
            },
          });
          assert.equal(created.response.status, 201);
          assert.equal(created.payload.campaign.status, 'draft');

          const sent = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(sent.response.status, 200);
          assert.equal(sent.payload.campaign.status, 'sent');
          assert.equal(sent.payload.dispatch.idempotent, false);
          assert.equal(sent.payload.dispatch.sentCount, 2);
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

test('pr campaigns: send succeeds for officer and lead, but forbidden for member', async () => {
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
              title: 'Role Test Campaign',
              subject: 'Role Test',
              body: 'Body',
              segmentType: 'committee_members',
            },
          });
          assert.equal(created.response.status, 201);

          // Member cannot send
          const blocked = await sendCampaign({
            server,
            actor: ACTORS.memberAi,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(blocked.response.status, 403);
          assert.equal(emailServer.requests.length, 0);

          // Officer CAN send
          const officerSent = await sendCampaign({
            server,
            actor: ACTORS.officerGlobal,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(officerSent.response.status, 200);
          assert.equal(officerSent.payload.campaign.status, 'sent');
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

test('pr campaigns: recipient preview returns expected count and sample variables', async () => {
  await prepareDatabase();
  const app = loadFreshApp();
  const server = await createServer(app);

  try {
    const routePath = '/core/pr/campaigns/recipients-preview';
    const headers = signedCoreHeaders({ method: 'POST', path: routePath, actor: ACTORS.publisherGlobal });

    // 1. Preview committee members
    const resCommittee = await requestJson(server, {
      method: 'POST',
      path: routePath,
      headers,
      body: {
        segmentType: 'committee_members',
        committeeId: IDS.committees.ai,
      },
    });
    assert.equal(resCommittee.response.status, 200);
    assert.equal(resCommittee.payload.totalCount >= 2, true);
    assert.equal(Array.isArray(resCommittee.payload.sampleRecipients), true);

    // 2. Preview custom sheet
    const resSheet = await requestJson(server, {
      method: 'POST',
      path: routePath,
      headers,
      body: {
        segmentType: 'custom_sheet',
        customRecipients: [
          { email: 'john@example.com', name: 'John Doe', Seat: 'A-12', role: 'Speaker' },
          { email: 'jane@example.com', name: 'Jane Smith', Seat: 'B-04', role: 'Attendee' },
        ],
      },
    });
    assert.equal(resSheet.response.status, 200);
    assert.equal(resSheet.payload.totalCount, 2);
    assert.equal(resSheet.payload.availableVariables.includes('sheet.Seat'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pr campaigns: custom sheet and template interpolation dispatches personalized email', async () => {
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
              title: 'Workshop Certificates',
              subject: 'Hello {{user.name}}, your seat is {{sheet.Seat}}',
              body: 'Dear {{user.name}},\n\nWelcome to {{user.committee}}. Your role is {{user.role}} and your seat is {{sheet.Seat}}.\n\nBest regards,\nBranch Team',
              segmentType: 'custom_sheet',
              customRecipients: [
                { email: 'custom1@ieee.local', name: 'Alice Walker', Seat: 'Row 1', role: 'Participant' },
                { email: 'custom2@ieee.local', name: 'Bob Roberts', Seat: 'Row 2', role: 'Speaker' },
              ],
            },
          });
          assert.equal(created.response.status, 201);
          assert.equal(created.payload.campaign.segmentType, 'custom_sheet');

          const sent = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(sent.response.status, 200);
          assert.equal(sent.payload.campaign.status, 'sent');
          assert.equal(sent.payload.dispatch.sentCount, 2);
          assert.equal(emailServer.requests.length, 2);

          // Verify template interpolation on individual emails
          const req1 = emailServer.requests.find((r) => r.body.to[0] === 'custom1@ieee.local');
          assert.ok(req1);
          assert.equal(req1.body.subject, 'Hello Alice Walker, your seat is Row 1');
          assert.equal(req1.body.text.includes('Alice Walker'), true);
          assert.equal(req1.body.text.includes('Row 1'), true);
          assert.equal(Boolean(req1.body.html), true);

          // Verify delivery log inspection
          const delivery = await getDelivery({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });
          assert.equal(delivery.response.status, 200);
          assert.equal(delivery.payload.delivery.attempts.length >= 1, true);
          assert.equal(Array.isArray(delivery.payload.delivery.attempts[0].logs), true);
          assert.equal(delivery.payload.delivery.attempts[0].logs.length, 2);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('pr campaigns: archiving, unarchiving, duplicating, and default exclusion from list', async () => {
  await prepareDatabase();

  const app = loadFreshApp();
  const server = await createServer(app);

  try {
    // 1. Create a campaign
    const created = await createCampaign({
      server,
      actor: ACTORS.publisherGlobal,
      body: {
        committeeId: IDS.committees.ai,
        title: 'Archivable Test Campaign',
        subject: 'Subject for Archive',
        body: 'Body text for archive test.',
        segmentType: 'committee_members',
      },
    });
    assert.equal(created.response.status, 201);
    const campId = created.payload.campaign.id;
    assert.equal(created.payload.campaign.status, 'draft');

    // 2. Archive campaign
    const archived = await archiveCampaign({
      server,
      actor: ACTORS.publisherGlobal,
      campaignId: campId,
    });
    assert.equal(archived.response.status, 200);
    assert.equal(archived.payload.campaign.status, 'archived');
    assert.equal(archived.payload.campaign.metadata.archivedFromStatus, 'draft');

    // 3. Verify it is excluded from listCampaigns by default
    const defaultList = await listCampaigns({
      server,
      actor: ACTORS.publisherGlobal,
    });
    assert.equal(defaultList.response.status, 200);
    const foundInDefault = defaultList.payload.campaigns.find((c) => c.id === campId);
    assert.equal(foundInDefault, undefined);

    // 4. Verify it is included when includeArchived=true or status=archived
    const archivedList = await listCampaigns({
      server,
      actor: ACTORS.publisherGlobal,
      query: 'status=archived',
    });
    assert.equal(archivedList.response.status, 200);
    const foundInArchived = archivedList.payload.campaigns.find((c) => c.id === campId);
    assert.ok(foundInArchived);
    assert.equal(foundInArchived.status, 'archived');

    // 5. Unarchive campaign and verify restoration of original status
    const unarchived = await unarchiveCampaign({
      server,
      actor: ACTORS.publisherGlobal,
      campaignId: campId,
    });
    assert.equal(unarchived.response.status, 200);
    assert.equal(unarchived.payload.campaign.status, 'draft');

    // 6. Duplicate campaign
    const duplicated = await duplicateCampaign({
      server,
      actor: ACTORS.publisherGlobal,
      campaignId: campId,
    });
    assert.equal(duplicated.response.status, 201);
    assert.equal(duplicated.payload.campaign.title, 'Archivable Test Campaign (Copy)');
    assert.equal(duplicated.payload.campaign.status, 'draft');
    assert.notEqual(duplicated.payload.campaign.id, campId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pr campaigns: claimDueScheduledCampaigns locks and claims scheduled campaigns without SQL errors', async () => {
  await prepareDatabase();
  const prRepo = require('../../src/repositories/prCampaignsRepository');

  // Create a campaign scheduled in the past
  const pastDate = new Date(Date.now() - 60000);
  const created = await prRepo.createCampaign({
    title: 'Scheduled Past Campaign',
    subject: 'Scheduled Subject',
    body: 'Scheduled Body',
    segmentType: 'committee_members',
    committeeId: IDS.committees.ai,
    status: 'scheduled',
    scheduledFor: pastDate,
    actorUserId: IDS.users.admin,
  });

  assert.equal(created.status, 'scheduled');

  // Claim due campaigns
  const claimed = await prRepo.claimDueScheduledCampaigns({ limit: 5 });
  assert.ok(Array.isArray(claimed));
  const found = claimed.find((c) => c.id === created.id);
  assert.ok(found, 'Created scheduled campaign must be in claimed list');
  assert.equal(found.status, 'sending');
  assert.equal(found.committee_name, 'AI Committee');
});

test('pr campaigns: full HTML document template is dispatched directly without duplicate wrapping', async () => {
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
          const customFullHtml = `<!DOCTYPE html><html><body><h1 id="custom-heading">Custom Full Template</h1><p>Hello {{user.name}}</p></body></html>`;

          const created = await createCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            body: {
              committeeId: IDS.committees.ai,
              title: 'Full Template Campaign',
              subject: 'Custom Subject',
              body: customFullHtml,
              segmentType: 'committee_members',
            },
          });

          const sent = await sendCampaign({
            server,
            actor: ACTORS.publisherGlobal,
            campaignId: created.payload.campaign.id,
          });

          assert.equal(sent.response.status, 200);
          assert.equal(sent.payload.campaign.status, 'sent');
          assert.equal(emailServer.requests.length, 2);

          const firstReq = emailServer.requests[0].body;
          assert.ok(firstReq.html.includes('<h1 id="custom-heading">Custom Full Template</h1>'));
          // Verify it did not double-wrap with default gradient header
          assert.equal(firstReq.html.includes('Official Communications & Outreach'), false);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});


