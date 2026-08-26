const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  IDS,
  bootstrapTestDatabase,
  closePool,
  prepareDatabase,
  signedHeaders,
} = require('./helpers');

function loadFreshApp() {
  const toDelete = [
    require.resolve('../../src/config/index'),
    require.resolve('../../src/app'),
    require.resolve('../../src/routes/coreRoutes'),
    require.resolve('../../src/controllers/taskController'),
    require.resolve('../../src/services/emailNotificationService'),
  ];
  for (const k of toDelete) {
    if (require.cache[k]) delete require.cache[k];
  }
  return require('../../src/app');
}

function createServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getBaseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function withEnv(overrides, runFn) {
  const original = { ...process.env };
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    return await runFn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(original)) {
      process.env[k] = v;
    }
  }
}

async function startEmailCaptureServer({ statusCode = 200, latencyMs = 0 } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });

      setTimeout(() => {
        res.statusCode = statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: statusCode < 400, capturedAt: new Date().toISOString() }));
      }, latencyMs);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('notifications: task assignment sends email to committee member with contract payload', async () => {
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
              title: 'Prepare workshop slide deck',
              description: 'Deck needs intro + code lab',
              assigneeUserId: 'member-ai-1',
              dueAt: '2026-02-28T10:00:00.000Z',
            }),
          });

          const responsePayload = await response.json();
          const taskId = responsePayload.task.id;

          assert.equal(response.status, 201);
          await new Promise((r) => setTimeout(r, 60));
          assert.equal(emailServer.requests.length, 1);

          const outbound = emailServer.requests[0];
          assert.equal(outbound.method, 'POST');
          assert.equal(outbound.url, '/email/send');
          assert.equal(outbound.headers['x-service-token'], 'integration-service-token');
          assert.equal(outbound.body.schemaVersion, '1.0');
          assert.equal(outbound.body.eventType, 'core.task.assigned');
          assert.equal(outbound.body.idempotencyKey, `core-task-assigned:${taskId}:member-ai-1`);
          assert.deepEqual(outbound.body.to, ['member.ai@ieee.local']);
          assert.equal(outbound.body.subject, '[AI Committee] New task assigned: Prepare workshop slide deck');
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

test('notifications: downstream non-2xx does not block task creation', async () => {
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
          await new Promise((r) => setTimeout(r, 60));
          assert.equal(emailServer.requests.length, 1);
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
