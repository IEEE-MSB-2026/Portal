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

test.before(async () => {
  await bootstrapTestDatabase();
});

test.after(async () => {
  await closePool();
});

test('task create: lead in committee can assign task to committee member', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/committees/${IDS.committees.ai}/tasks`;
    const headers = signedHeaders({
      method: 'POST',
      path,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Prepare session intro',
        description: 'Slides + runbook',
        assigneeUserId: 'member-ai-1',
      }),
    });

    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.task.title, 'Prepare session intro');
    assert.equal(payload.task.assigneeUserId, 'member-ai-1');

    const logCount = await query('SELECT COUNT(*)::int AS c FROM task_activity_log');
    assert.equal(logCount.rows[0].c >= 2, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task create: lead cannot assign task to non-member of committee', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const path = `/core/committees/${IDS.committees.ai}/tasks`;
    const headers = signedHeaders({
      method: 'POST',
      path,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${path}`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Cross committee assignment',
        assigneeUserId: 'member-web-1',
      }),
    });

    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Assignee must be a member of this committee');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task status: member can move own task todo -> in_progress -> done', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const patchPath = `/core/tasks/${IDS.tasks.aiMemberTodo}/status`;
    const headers = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const first = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    assert.equal(first.status, 200);

    const second = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'done' }),
    });

    const secondPayload = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondPayload.task.status, 'done');

    // Reopen task from done -> in_progress
    const reopen = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    const reopenPayload = await reopen.json();
    assert.equal(reopen.status, 200);
    assert.equal(reopenPayload.task.status, 'in_progress');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task status: member cannot update another assignee task', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const patchPath = `/core/tasks/${IDS.tasks.aiLeadTodo}/status`;
    const headers = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task status: member invalid transition todo -> done returns 400', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const patchPath = `/core/tasks/${IDS.tasks.aiMemberTodo}/status`;
    const headers = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'done' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Invalid task status transition');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task status: unknown task in caller scope returns 404', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const taskId = '99999999-9999-4999-8999-999999999999';
    const patchPath = `/core/tasks/${taskId}/status`;
    const headers = signedHeaders({
      method: 'PATCH',
      path: patchPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const response = await fetch(`${getBaseUrl(server)}${patchPath}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.error, 'Task not found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
