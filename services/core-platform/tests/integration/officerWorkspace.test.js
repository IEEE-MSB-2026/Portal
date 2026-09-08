const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bootstrapTestDatabase,
  closePool,
  createServer,
  getBaseUrl,
  setupTestEnv,
  signedHeaders,
  seedBaseData,
  resetDatabase,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');
const { query } = require('../../src/db/pool');

async function requestJson(server, { method, path, headers, body }) {
  const response = await fetch(`${getBaseUrl(server)}${path}`, {
    method,
    headers: body === undefined
      ? headers
      : {
        ...(headers || {}),
        'content-type': 'application/json',
      },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: payload,
  };
}

test('Officer Executive Workspace Integration Tests', async (t) => {
  let server;
  const adminId = '11111111-0000-4000-8000-000000000001';
  const officerId = '11111111-0000-4000-8000-000000000002';
  const memberId = '11111111-0000-4000-8000-000000000009';

  const adminHeaders = (method, path) =>
    signedHeaders({
      method,
      path,
      userId: adminId,
      userEmail: 'admin@ieee.local',
      userRole: 'admin',
      scopeType: 'global',
      scopeId: 'global',
    });

  const officerHeaders = (method, path) =>
    signedHeaders({
      method,
      path,
      userId: officerId,
      userEmail: 'officer@ieee.local',
      userRole: 'officer',
      scopeType: 'global',
      scopeId: 'global',
    });

  const memberHeaders = (method, path) =>
    signedHeaders({
      method,
      path,
      userId: memberId,
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: '11111111-1111-4111-8111-111111111111',
    });

  t.before(async () => {
    await bootstrapTestDatabase();
    await resetDatabase();
    await seedBaseData();
    server = await createServer(app);
  });

  t.after(async () => {
    if (server) await server.close();
    await closePool();
  });

  // ----------------------------------------------------
  // Access Control Checks
  // ----------------------------------------------------
  await t.test('Regular member receives 403 Forbidden accessing officer workspace endpoints', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/tasks',
      headers: memberHeaders('GET', '/core/officers/tasks'),
    });
    assert.equal(res.status, 403);
  });

  // ----------------------------------------------------
  // Tab 1: Board Kanban Tasks
  // ----------------------------------------------------
  let createdTaskId;

  await t.test('Officer can create a Board Kanban task', async () => {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/core/officers/tasks',
      headers: officerHeaders('POST', '/core/officers/tasks'),
      body: {
        title: 'Draft Annual IEEE Student Branch Report',
        description: 'Compile committee achievements and budget expenditures for Region 8 submission.',
        priority: 'high',
        dueDate: '2026-10-15T23:59:59Z',
      },
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.task);
    assert.equal(res.body.task.title, 'Draft Annual IEEE Student Branch Report');
    assert.equal(res.body.task.priority, 'high');
    assert.equal(res.body.task.status, 'todo');
    assert.equal(res.body.task.isBoardTask, true);
    createdTaskId = res.body.task.id;
  });

  await t.test('Officer can list active Board Kanban tasks', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/tasks',
      headers: officerHeaders('GET', '/core/officers/tasks'),
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.tasks));
    assert.ok(res.body.tasks.some((task) => task.id === createdTaskId));
  });

  await t.test('Officer can update Board task status to in_progress and assign to officer', async () => {
    const res = await requestJson(server, {
      method: 'PATCH',
      path: `/core/officers/tasks/${createdTaskId}`,
      headers: officerHeaders('PATCH', `/core/officers/tasks/${createdTaskId}`),
      body: {
        status: 'in_progress',
        assigneeUserId: officerId,
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, 'in_progress');
    assert.equal(res.body.task.assigneeUserId, officerId);
  });

  await t.test('Officer can archive and restore a Board task', async () => {
    // Archive
    const archiveRes = await requestJson(server, {
      method: 'POST',
      path: `/core/officers/tasks/${createdTaskId}/archive`,
      headers: officerHeaders('POST', `/core/officers/tasks/${createdTaskId}/archive`),
      body: { isArchived: true },
    });
    assert.equal(archiveRes.status, 200);
    assert.equal(archiveRes.body.task.isArchived, true);

    // Verify task is in archived list
    const listArchivedRes = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/tasks/archived',
      headers: officerHeaders('GET', '/core/officers/tasks/archived'),
    });
    assert.equal(listArchivedRes.status, 200);
    assert.ok(listArchivedRes.body.tasks.some((task) => task.id === createdTaskId));

    // Restore
    const restoreRes = await requestJson(server, {
      method: 'POST',
      path: `/core/officers/tasks/${createdTaskId}/archive`,
      headers: officerHeaders('POST', `/core/officers/tasks/${createdTaskId}/archive`),
      body: { isArchived: false },
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.body.task.isArchived, false);
  });

  // ----------------------------------------------------
  // Tab 2: Cross-Committee Health & Progress Cockpit
  // ----------------------------------------------------
  await t.test('Officer can view branch cockpit statistics with master KPIs and per-committee health', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/cockpit',
      headers: officerHeaders('GET', '/core/officers/cockpit'),
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.kpis);
    assert.ok(typeof res.body.kpis.totalTasks === 'number');
    assert.ok(typeof res.body.kpis.completionRate === 'number');
    assert.ok(Array.isArray(res.body.committees));
    assert.ok(res.body.committees.length > 0);

    const firstComm = res.body.committees[0];
    assert.ok(firstComm.id);
    assert.ok(firstComm.name);
    assert.ok(firstComm.tasks);
    assert.ok(typeof firstComm.tasks.total === 'number');
  });

  // ----------------------------------------------------
  // Tab 3: Governance Vault Documents
  // ----------------------------------------------------
  let createdDocId;

  await t.test('Officer can upload and list governance documents', async () => {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/core/officers/documents',
      headers: officerHeaders('POST', '/core/officers/documents'),
      body: {
        title: 'IEEE Menoufia Student Branch Plan 2026',
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/plan-2026.pdf',
        fileSizeBytes: 2048500,
        tag: 'Plan',
        description: 'Official branch constitution and operational plan signed by branch counselor.',
      },
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.document);
    assert.equal(res.body.document.title, 'IEEE Menoufia Student Branch Plan 2026');
    assert.equal(res.body.document.tag, 'Plan');
    createdDocId = res.body.document.id;

    // List and filter by tag
    const listRes = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/documents?tag=Plan',
      headers: officerHeaders('GET', '/core/officers/documents'),
    });
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.documents.some((d) => d.id === createdDocId));
  });

  await t.test('Officer can delete governance document and queue file asset for destruction', async () => {
    const res = await requestJson(server, {
      method: 'DELETE',
      path: `/core/officers/documents/${createdDocId}`,
      headers: officerHeaders('DELETE', `/core/officers/documents/${createdDocId}`),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdDocId);

    // Verify file asset was queued for deletion
    const queueCheck = await query(
      "SELECT status, secure_url FROM file_assets WHERE secure_url = $1",
      ['https://res.cloudinary.com/demo/raw/upload/v1/plan-2026.pdf']
    );
    assert.equal(queueCheck.rows.length, 1);
    assert.equal(queueCheck.rows[0].status, 'pending_deletion');
  });

  // ----------------------------------------------------
  // Tab 4: Excom Internal Team & Role Assignments
  // ----------------------------------------------------
  let appointedMemberId;

  await t.test('Non-admin officer receives 403 Forbidden attempting to assign Excom position', async () => {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/core/officers/excom',
      headers: officerHeaders('POST', '/core/officers/excom'),
      body: {
        userId: memberId,
        position: 'treasurer',
        season: '2025/2026',
      },
    });
    assert.equal(res.status, 403);
  });

  await t.test('Admin can search candidates and assign member as Excom Treasurer', async () => {
    // Search candidates
    const searchRes = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/candidates?q=Active',
      headers: adminHeaders('GET', '/core/officers/candidates'),
    });
    assert.equal(searchRes.status, 200);
    assert.ok(Array.isArray(searchRes.body.candidates));

    // Assign position
    const assignRes = await requestJson(server, {
      method: 'POST',
      path: '/core/officers/excom',
      headers: adminHeaders('POST', '/core/officers/excom'),
      body: {
        userId: memberId,
        position: 'treasurer',
        customTitle: 'Branch Executive Treasurer',
        season: '2025/2026',
      },
    });

    assert.equal(assignRes.status, 201);
    assert.ok(assignRes.body.member);
    assert.equal(assignRes.body.member.position, 'treasurer');
    assert.equal(assignRes.body.member.customTitle, 'Branch Executive Treasurer');
    appointedMemberId = assignRes.body.member.id;

    // Verify member now holds officer role in auth_user_roles
    const roleCheck = await query(
      "SELECT role FROM auth_user_roles WHERE user_id = $1 AND role = 'officer' AND scope_type = 'global'",
      [memberId]
    );
    assert.equal(roleCheck.rows.length, 1);
  });

  await t.test('Both Officers and Admins can view Excom internal roster', async () => {
    const res = await requestJson(server, {
      method: 'GET',
      path: '/core/officers/excom?season=2025/2026',
      headers: officerHeaders('GET', '/core/officers/excom'),
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.members));
    assert.ok(res.body.members.some((m) => m.id === appointedMemberId));
  });

  await t.test('Admin can remove an Excom member assignment', async () => {
    const res = await requestJson(server, {
      method: 'DELETE',
      path: `/core/officers/excom/${appointedMemberId}`,
      headers: adminHeaders('DELETE', `/core/officers/excom/${appointedMemberId}`),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, appointedMemberId);
  });

  // ----------------------------------------------------
  // Public Officer Drag-and-Drop Reorder (Tab 5 / About)
  // ----------------------------------------------------
  await t.test('Admin can batch reorder public branch officers', async () => {
    // Insert two test public officers
    const ins1 = await query(`
      INSERT INTO branch_officers (name, role, season, is_current_season, display_order, is_active)
      VALUES ('Officer Alpha', 'Chair', '2025/2026', TRUE, 1, TRUE)
      RETURNING id
    `);
    const ins2 = await query(`
      INSERT INTO branch_officers (name, role, season, is_current_season, display_order, is_active)
      VALUES ('Officer Beta', 'Vice Chair', '2025/2026', TRUE, 2, TRUE)
      RETURNING id
    `);

    const id1 = ins1.rows[0].id;
    const id2 = ins2.rows[0].id;

    const res = await requestJson(server, {
      method: 'PUT',
      path: '/core/admin/officers/reorder',
      headers: adminHeaders('PUT', '/core/admin/officers/reorder'),
      body: {
        orderedItems: [
          { id: id2, displayOrder: 1 },
          { id: id1, displayOrder: 2 },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);

    // Verify new order in database
    const checkOrder = await query('SELECT id, display_order FROM branch_officers WHERE id IN ($1, $2) ORDER BY display_order ASC', [id1, id2]);
    assert.equal(checkOrder.rows[0].id, id2);
    assert.equal(checkOrder.rows[0].display_order, 1);
    assert.equal(checkOrder.rows[1].id, id1);
    assert.equal(checkOrder.rows[1].display_order, 2);
  });

  // Clean up created board task
  await t.test('Delete Board task cleans up properly', async () => {
    const res = await requestJson(server, {
      method: 'DELETE',
      path: `/core/officers/tasks/${createdTaskId}`,
      headers: officerHeaders('DELETE', `/core/officers/tasks/${createdTaskId}`),
    });
    assert.equal(res.status, 200);
  });
});
