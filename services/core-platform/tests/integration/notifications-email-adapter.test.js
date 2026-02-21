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

function createEmailCaptureServer({ statusCode = 202 } = {}) {
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

      res.statusCode = statusCode;
      res.setHeader('content-type', 'application/json');
      if (statusCode >= 200 && statusCode < 300) {
        res.end('{"status":"sent"}');
      } else {
        res.end('{"error":"downstream failure"}');
      }
    });
  });

  return { requests, server };
}

async function startEmailCaptureServer(options) {
  const harness = createEmailCaptureServer(options);
  await new Promise((resolve) => harness.server.listen(0, '127.0.0.1', resolve));

  const address = harness.server.address();
  return {
    requests: harness.requests,
    server: harness.server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => harness.server.close(resolve));
    },
  };
}

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
  clearCoreModuleCache();
});

test('notifications: task creation sends authenticated email payload to assignee', async () => {
  await prepareDatabase();
  const emailServer = await startEmailCaptureServer();

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'integration-service-token',
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const routePath = `/core/committees/${IDS.committees.ai}/tasks`;
          const headers = signedHeaders({
            method: 'POST',
            path: routePath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const response = await fetch(`${getBaseUrl(server)}${routePath}`, {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'Prepare session intro',
              description: 'Slides + runbook',
              assigneeUserId: 'member-ai-1',
              dueAt: '2026-02-28T10:00:00.000Z',
            }),
          });

          const responsePayload = await response.json();
          assert.equal(response.status, 201);
          assert.equal(emailServer.requests.length, 1);

          const outbound = emailServer.requests[0];
          assert.equal(outbound.method, 'POST');
          assert.equal(outbound.url, '/email/send');
          assert.equal(outbound.headers['x-service-token'], 'integration-service-token');
          assert.equal(outbound.body.schemaVersion, '1.0');
          assert.equal(outbound.body.eventType, 'core.task.assigned');
          assert.deepEqual(outbound.body.to, ['member.ai@ieee.local']);
          assert.equal(outbound.body.subject, '[AI Committee] New task assigned: Prepare session intro');
          assert.equal(outbound.body.idempotencyKey, `core-task-assigned:${responsePayload.task.id}:member-ai-1`);
          assert.equal(typeof outbound.body.correlationId, 'string');
          assert.equal(typeof outbound.body.createdAt, 'string');
          assert.equal(String(outbound.body.text).includes('Committee: AI Committee'), true);
          assert.equal(String(outbound.body.text).includes('Assigned by: lead-ai-1'), true);
          assert.equal(String(outbound.body.text).includes('Due at: 2026-02-28T10:00:00.000Z'), true);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('notifications: announcement creation sends email to all committee members including author', async () => {
  await prepareDatabase();
  const emailServer = await startEmailCaptureServer();

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'integration-service-token',
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const routePath = `/core/committees/${IDS.committees.ai}/announcements`;
          const headers = signedHeaders({
            method: 'POST',
            path: routePath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const response = await fetch(`${getBaseUrl(server)}${routePath}`, {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'AI Hackathon Prep',
              body: 'Prepare demo topics before Friday.',
            }),
          });

          const responsePayload = await response.json();
          const announcementId = responsePayload.announcement.id;

          assert.equal(response.status, 201);
          assert.equal(emailServer.requests.length, 2);

          const recipients = emailServer.requests
            .map((entry) => entry.body?.to?.[0])
            .sort();
          assert.deepEqual(recipients, ['lead.ai@ieee.local', 'member.ai@ieee.local']);

          for (const outbound of emailServer.requests) {
            assert.equal(outbound.method, 'POST');
            assert.equal(outbound.url, '/email/send');
            assert.equal(outbound.headers['x-service-token'], 'integration-service-token');
            assert.equal(outbound.body.schemaVersion, '1.0');
            assert.equal(outbound.body.eventType, 'core.committee.announcement.created');
            assert.equal(outbound.body.subject, '[AI Committee] New announcement: AI Hackathon Prep');
            assert.equal(
              String(outbound.body.idempotencyKey).startsWith(`core-announcement:${announcementId}:`),
              true
            );
            assert.equal(String(outbound.body.text).includes('Created by: lead-ai-1'), true);
          }
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('notifications: downstream non-2xx does not block task and announcement creation', async () => {
  await prepareDatabase();
  const emailServer = await startEmailCaptureServer({ statusCode: 500 });

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: 'integration-service-token',
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const taskPath = `/core/committees/${IDS.committees.ai}/tasks`;
          const taskHeaders = signedHeaders({
            method: 'POST',
            path: taskPath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const taskResponse = await fetch(`${getBaseUrl(server)}${taskPath}`, {
            method: 'POST',
            headers: {
              ...taskHeaders,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'Fallback-safe task',
              description: 'Should still persist even when email fails',
              assigneeUserId: 'member-ai-1',
            }),
          });

          assert.equal(taskResponse.status, 201);

          const announcementPath = `/core/committees/${IDS.committees.ai}/announcements`;
          const announcementHeaders = signedHeaders({
            method: 'POST',
            path: announcementPath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const announcementResponse = await fetch(`${getBaseUrl(server)}${announcementPath}`, {
            method: 'POST',
            headers: {
              ...announcementHeaders,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'Fallback-safe announcement',
              body: 'Creation should succeed even if notifications fail.',
            }),
          });

          assert.equal(announcementResponse.status, 201);
          assert.equal(emailServer.requests.length, 3);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
  } finally {
    await emailServer.close();
  }
});

test('notifications: missing auth token disables outbound calls while keeping business responses successful', async () => {
  await prepareDatabase();
  const emailServer = await startEmailCaptureServer();

  try {
    await withEnv(
      {
        EMAIL_SERVICE_URL: emailServer.baseUrl,
        EMAIL_SERVICE_AUTH_TOKEN: undefined,
        EMAIL_SERVICE_TIMEOUT_MS: '1000',
      },
      async () => {
        const app = loadFreshApp();
        const server = await createServer(app);

        try {
          const taskPath = `/core/committees/${IDS.committees.ai}/tasks`;
          const taskHeaders = signedHeaders({
            method: 'POST',
            path: taskPath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const taskResponse = await fetch(`${getBaseUrl(server)}${taskPath}`, {
            method: 'POST',
            headers: {
              ...taskHeaders,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'No outbound email task',
              description: 'Still should be created',
              assigneeUserId: 'member-ai-1',
            }),
          });
          assert.equal(taskResponse.status, 201);

          const announcementPath = `/core/committees/${IDS.committees.ai}/announcements`;
          const announcementHeaders = signedHeaders({
            method: 'POST',
            path: announcementPath,
            userId: 'lead-ai-1',
            userEmail: 'lead.ai@ieee.local',
            userRole: 'lead',
            scopeType: 'committee',
            scopeId: IDS.committees.ai,
          });

          const announcementResponse = await fetch(`${getBaseUrl(server)}${announcementPath}`, {
            method: 'POST',
            headers: {
              ...announcementHeaders,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: 'No outbound email announcement',
              body: 'Still should be created',
            }),
          });
          assert.equal(announcementResponse.status, 201);
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
