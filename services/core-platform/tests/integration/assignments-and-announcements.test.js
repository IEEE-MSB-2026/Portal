const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IDS,
  bootstrapTestDatabase,
  createServer,
  getBaseUrl,
  prepareDatabase,
  setupTestEnv,
  signedHeaders,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

test.before(async () => {
  await bootstrapTestDatabase();
});

test('committee announcements: lead can create and list announcements; member cannot create', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const postPath = `/core/committees/${IDS.committees.ai}/announcements`;
    const leadHeaders = signedHeaders({
      method: 'POST',
      path: postPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    // 1. Lead creates announcement
    const createRes = await fetch(`${getBaseUrl(server)}${postPath}`, {
      method: 'POST',
      headers: {
        ...leadHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Midterm Committee Meeting',
        body: 'Please attend our sync session this Thursday at 7 PM.',
        isPinned: true,
      }),
    });

    const createPayload = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createPayload.announcement.title, 'Midterm Committee Meeting');
    assert.equal(createPayload.announcement.isPinned, true);

    // 2. Member creates announcement (should fail 403)
    const memberHeaders = signedHeaders({
      method: 'POST',
      path: postPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const forbiddenRes = await fetch(`${getBaseUrl(server)}${postPath}`, {
      method: 'POST',
      headers: {
        ...memberHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Spam Post',
        body: 'Unauthorized announcement',
      }),
    });
    assert.equal(forbiddenRes.status, 403);

    // 3. Member lists announcements (should succeed 200)
    const getPath = `/core/committees/${IDS.committees.ai}/announcements`;
    const listHeaders = signedHeaders({
      method: 'GET',
      path: getPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const listRes = await fetch(`${getBaseUrl(server)}${getPath}`, {
      method: 'GET',
      headers: listHeaders,
    });

    const listPayload = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.equal(listPayload.announcements.length, 1);
    assert.equal(listPayload.announcements[0].title, 'Midterm Committee Meeting');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('assignments lifecycle: lead creates, member delivers work, lead grades submission', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    const assignmentsPath = `/core/committees/${IDS.committees.ai}/assignments`;
    const leadHeaders = signedHeaders({
      method: 'POST',
      path: assignmentsPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    // 1. Lead creates assignment
    const createRes = await fetch(`${getBaseUrl(server)}${assignmentsPath}`, {
      method: 'POST',
      headers: {
        ...leadHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'PyTorch Image Classifier Exercise',
        description: 'Build a CNN on CIFAR-10 and upload your notebook or report.',
        dueDate: '2026-09-01T23:59:59.000Z',
        maxPoints: 100,
        attachmentUrl: 'https://res.cloudinary.com/demo/raw/upload/v12345/starter_code.zip',
        attachmentName: 'starter_code.zip',
      }),
    });

    const createPayload = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createPayload.assignment.title, 'PyTorch Image Classifier Exercise');
    const assignmentId = createPayload.assignment.id;

    // 2. Member lists assignments
    const memberGetHeaders = signedHeaders({
      method: 'GET',
      path: assignmentsPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const listRes = await fetch(`${getBaseUrl(server)}${assignmentsPath}`, {
      method: 'GET',
      headers: memberGetHeaders,
    });

    const listPayload = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.equal(listPayload.assignments.length, 1);
    assert.equal(listPayload.assignments[0].mySubmission, null);

    // 3. Member submits assignment
    const submitPath = `/core/committees/${IDS.committees.ai}/assignments/${assignmentId}/submit`;
    const submitHeaders = signedHeaders({
      method: 'POST',
      path: submitPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const submitRes = await fetch(`${getBaseUrl(server)}${submitPath}`, {
      method: 'POST',
      headers: {
        ...submitHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/v12345/solution_cifar10.ipynb',
        fileName: 'solution_cifar10.ipynb',
        notes: 'Achieved 89% validation accuracy on test split.',
      }),
    });

    const submitPayload = await submitRes.json();
    assert.equal(submitRes.status, 200);
    assert.equal(submitPayload.submission.status, 'submitted');
    const submissionId = submitPayload.submission.id;

    // 4. Lead views submissions
    const submissionsPath = `/core/committees/${IDS.committees.ai}/assignments/${assignmentId}/submissions`;
    const leadSubmissionsHeaders = signedHeaders({
      method: 'GET',
      path: submissionsPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const submissionsRes = await fetch(`${getBaseUrl(server)}${submissionsPath}`, {
      method: 'GET',
      headers: leadSubmissionsHeaders,
    });

    const submissionsPayload = await submissionsRes.json();
    assert.equal(submissionsRes.status, 200);
    assert.equal(submissionsPayload.submissions.length, 1);
    assert.equal(submissionsPayload.submissions[0].fileName, 'solution_cifar10.ipynb');

    // 5. Lead grades submission
    const gradePath = `/core/committees/${IDS.committees.ai}/assignments/${assignmentId}/submissions/${submissionId}/grade`;
    const gradeHeaders = signedHeaders({
      method: 'PATCH',
      path: gradePath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const gradeRes = await fetch(`${getBaseUrl(server)}${gradePath}`, {
      method: 'PATCH',
      headers: {
        ...gradeHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grade: 95,
        feedback: 'Excellent model architecture and clean notebook presentation!',
        status: 'graded',
      }),
    });

    const gradePayload = await gradeRes.json();
    assert.equal(gradeRes.status, 200);
    assert.equal(gradePayload.submission.grade, 95);
    assert.equal(gradePayload.submission.status, 'graded');

    // 6. Member dashboard returns pending / submitted assignments & activities
    const dashPath = '/core/me/dashboard';
    const dashHeaders = signedHeaders({
      method: 'GET',
      path: dashPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    const dashRes = await fetch(`${getBaseUrl(server)}${dashPath}`, {
      method: 'GET',
      headers: dashHeaders,
    });

    const dashPayload = await dashRes.json();
    assert.equal(dashRes.status, 200);
    assert.ok(Array.isArray(dashPayload.pendingAssignments));
    assert.equal(dashPayload.pendingAssignments.length, 1);
    assert.equal(dashPayload.pendingAssignments[0].isSubmitted, true);
    assert.equal(dashPayload.pendingAssignments[0].submissionGrade, 95);

    // Member sees assignment_graded activity for themselves
    assert.ok(Array.isArray(dashPayload.recentActivity));
    const memberGradedActivity = dashPayload.recentActivity.find((a) => a.activityType === 'assignment_graded');
    assert.ok(memberGradedActivity, 'Member should see assignment_graded activity');

    // 7. GET /core/me/stats endpoint
    const statsPath = '/core/me/stats';
    const statsHeaders = signedHeaders({
      method: 'GET',
      path: statsPath,
      userId: 'member-ai-1',
      userEmail: 'member.ai@ieee.local',
      userRole: 'member',
      scopeType: 'global',
      scopeId: 'global',
    });

    const statsRes = await fetch(`${getBaseUrl(server)}${statsPath}`, {
      method: 'GET',
      headers: statsHeaders,
    });

    const statsPayload = await statsRes.json();
    assert.equal(statsRes.status, 200);
    assert.ok(statsPayload.tasks);
    assert.ok(statsPayload.assignments);
    assert.equal(statsPayload.assignments.total, 1);
    assert.equal(statsPayload.assignments.submitted, 1);
    assert.equal(statsPayload.assignments.graded, 1);
    assert.ok(statsPayload.committeesCount >= 1);
    assert.ok(statsPayload.daysMember >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('resource edit, announcement pin toggle, unassigned task creation & claim', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    // 1. Create announcement and toggle pin
    const postAnnPath = `/core/committees/${IDS.committees.ai}/announcements`;
    const leadHeaders = signedHeaders({
      method: 'POST',
      path: postAnnPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const annRes = await fetch(`${getBaseUrl(server)}${postAnnPath}`, {
      method: 'POST',
      headers: { ...leadHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Weekly Sync',
        body: 'Sync at 7pm',
        isPinned: false,
      }),
    });
    const annPayload = await annRes.json();
    assert.equal(annRes.status, 201);
    const announcementId = annPayload.announcement.id;

    // Pin announcement
    const pinPath = `/core/committees/${IDS.committees.ai}/announcements/${announcementId}/pin`;
    const pinHeaders = signedHeaders({
      method: 'PATCH',
      path: pinPath,
      userId: 'lead-ai-1',
      userEmail: 'lead.ai@ieee.local',
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    const pinRes = await fetch(`${getBaseUrl(server)}${pinPath}`, {
      method: 'PATCH',
      headers: { ...pinHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ isPinned: true }),
    });
    const pinPayload = await pinRes.json();
    assert.equal(pinRes.status, 200);
    assert.equal(pinPayload.announcement.isPinned, true);

    // 2. Create resource and edit title/description
    const postResPath = `/core/committees/${IDS.committees.ai}/resources`;
    const resCreateRes = await fetch(`${getBaseUrl(server)}${postResPath}`, {
      method: 'POST',
      headers: {
        ...signedHeaders({
          method: 'POST',
          path: postResPath,
          userId: 'lead-ai-1',
          userEmail: 'lead.ai@ieee.local',
          userRole: 'lead',
          scopeType: 'committee',
          scopeId: IDS.committees.ai,
        }),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Robotics Design Guide',
        url: 'https://ieee.org/design.pdf',
        resourceType: 'document',
        description: 'Initial draft',
      }),
    });
    const resCreatePayload = await resCreateRes.json();
    assert.equal(resCreateRes.status, 201);
    const resourceId = resCreatePayload.resource.id;

    // Edit resource
    const editResPath = `/core/committees/${IDS.committees.ai}/resources/${resourceId}`;
    const editRes = await fetch(`${getBaseUrl(server)}${editResPath}`, {
      method: 'PATCH',
      headers: {
        ...signedHeaders({
          method: 'PATCH',
          path: editResPath,
          userId: 'lead-ai-1',
          userEmail: 'lead.ai@ieee.local',
          userRole: 'lead',
          scopeType: 'committee',
          scopeId: IDS.committees.ai,
        }),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Robotics Design Guide v2',
        description: 'Updated guidelines for 2026',
      }),
    });
    const editPayload = await editRes.json();
    assert.equal(editRes.status, 200);
    assert.equal(editPayload.resource.title, 'Robotics Design Guide v2');
    assert.equal(editPayload.resource.description, 'Updated guidelines for 2026');

    // 3. Create unassigned task (assigneeUserId omitted/null)
    const taskPath = `/core/committees/${IDS.committees.ai}/tasks`;
    const taskCreateRes = await fetch(`${getBaseUrl(server)}${taskPath}`, {
      method: 'POST',
      headers: {
        ...signedHeaders({
          method: 'POST',
          path: taskPath,
          userId: 'lead-ai-1',
          userEmail: 'lead.ai@ieee.local',
          userRole: 'lead',
          scopeType: 'committee',
          scopeId: IDS.committees.ai,
        }),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Arena Wire Setup',
        description: 'Setup cable harnesses',
        priority: 'high',
      }),
    });
    const taskCreatePayload = await taskCreateRes.json();
    assert.equal(taskCreateRes.status, 201);
    assert.equal(taskCreatePayload.task.assigneeUserId, null);
    const taskId = taskCreatePayload.task.id;

    // 4. Member claims the unassigned task
    const claimPath = `/core/tasks/${taskId}/claim`;
    const claimRes = await fetch(`${getBaseUrl(server)}${claimPath}`, {
      method: 'PATCH',
      headers: {
        ...signedHeaders({
          method: 'PATCH',
          path: claimPath,
          userId: 'member-ai-1',
          userEmail: 'member.ai@ieee.local',
          userRole: 'member',
          scopeType: 'committee',
          scopeId: IDS.committees.ai,
        }),
        'content-type': 'application/json',
      },
    });
    const claimPayload = await claimRes.json();
    assert.equal(claimRes.status, 200);
    assert.ok(claimPayload.task.assigneeUserId);
    assert.equal(claimPayload.task.status, 'todo');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
