const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Setup environment for testing
process.env.NODE_ENV = 'test';
process.env.CORE_USE_PGMEM = 'true';
process.env.PORT = '5070';
process.env.GATEWAY_SHARED_SECRET = 'test-gateway-shared-secret';
process.env.CORE_GATEWAY_SHARED_SECRET = 'test-gateway-shared-secret';
process.env.AUTH_CLAIMS_HMAC_SECRET = 'test-event-claims-secret';

const { prepareDatabase, IDS, closePool } = require('../../core-platform/tests/integration/helpers');
const coreConfig = require('../../core-platform/src/config');
const coreApp = require('../../core-platform/src/app');
const fileApp = require('../../file-service/src/app');
const gatewayApp = require('../src/index');
const config = require('../src/config');

describe('Master End-to-End Portal Flow Verification', () => {
  let coreServer;
  let coreBaseUrl;
  let fileServer;
  let fileBaseUrl;
  let gatewayServer;
  let gatewayBaseUrl;

  before(async () => {
    // 1. Prepare Core Postgres (in-memory) database
    await prepareDatabase();

    // 2. Start Core Platform App
    coreServer = http.createServer(coreApp);
    await new Promise((resolve) => coreServer.listen(0, '127.0.0.1', resolve));
    coreBaseUrl = `http://127.0.0.1:${coreServer.address().port}`;
    config.corePlatformUrl = coreBaseUrl;

    // 3. Start File Service App
    fileServer = http.createServer(fileApp);
    await new Promise((resolve) => fileServer.listen(0, '127.0.0.1', resolve));
    fileBaseUrl = `http://127.0.0.1:${fileServer.address().port}`;
    config.fileServiceUrl = fileBaseUrl;

    // 4. Start Gateway App
    gatewayServer = http.createServer(gatewayApp);
    await new Promise((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
    gatewayBaseUrl = `http://127.0.0.1:${gatewayServer.address().port}`;

    config.gatewaySharedSecret = coreConfig.gatewaySharedSecret;
    config.iamServiceAuthToken = 'test-iam-token';
    coreConfig.iam.serviceUrl = gatewayBaseUrl;
    coreConfig.iam.serviceAuthToken = 'test-iam-token';
  });

  after(async () => {
    await closePool();
    if (coreServer) await new Promise((resolve) => coreServer.close(resolve));
    if (fileServer) await new Promise((resolve) => fileServer.close(resolve));
    if (gatewayServer) await new Promise((resolve) => gatewayServer.close(resolve));
  });

  // Helper to authenticate via Gateway
  async function loginAs(email, password = 'password123') {
    const res = await fetch(`${gatewayBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `Login failed for ${email}`);
    const data = await res.json();
    return { token: data.token, user: data.user };
  }

  test('Flow 1: Visitor can browse public committees, public announcements, and published albums', async () => {
    // 1.1 Public Committees
    const commRes = await fetch(`${gatewayBaseUrl}/api/core/public/committees`);
    assert.equal(commRes.status, 200);
    const commBody = await commRes.json();
    assert.ok(Array.isArray(commBody.committees));
    assert.ok(commBody.committees.length >= 3);
    const ai = commBody.committees.find((c) => c.slug === 'ai');
    assert.ok(ai);
    assert.ok(ai.description);
    assert.ok(Array.isArray(ai.activities));

    // 1.2 Public Announcements
    const annRes = await fetch(`${gatewayBaseUrl}/api/core/public/announcements`);
    assert.equal(annRes.status, 200);
    const annBody = await annRes.json();
    assert.ok(Array.isArray(annBody.announcements));

    // 1.3 Public Media Albums
    const albumRes = await fetch(`${gatewayBaseUrl}/api/core/public/media/albums`);
    assert.equal(albumRes.status, 200);
    const albumBody = await albumRes.json();
    assert.ok(Array.isArray(albumBody.albums));
  });

  test('Flow 2: Member dashboard aggregates personal committees, tasks, and announcements', async () => {
    const { token } = await loginAs('member.ai@ieee.local');

    const dashRes = await fetch(`${gatewayBaseUrl}/api/core/me/dashboard`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(dashRes.status, 200);
    const dash = await dashRes.json();
    assert.ok(dash.user);
    assert.equal(dash.user.email, 'member.ai@ieee.local');
    assert.ok(Array.isArray(dash.committees));
    assert.ok(Array.isArray(dash.tasks.items));
    assert.ok(Array.isArray(dash.recentAnnouncements));
  });

  test('Flow 3: Committee Workspace - Lead assigns task, Member transitions todo -> in_progress -> done', async () => {
    const leadAuth = await loginAs('lead.ai@ieee.local');
    const memberAuth = await loginAs('member.ai@ieee.local');
    const committeeId = IDS.committees.ai;

    // 3.1 Lead views workspace
    const wsRes = await fetch(`${gatewayBaseUrl}/api/core/committees/${committeeId}/workspace`, {
      headers: { authorization: `Bearer ${leadAuth.token}` },
    });
    assert.equal(wsRes.status, 200);
    const ws = await wsRes.json();
    assert.equal(ws.committee.name, 'AI Committee');

    // 3.2 Lead assigns a new task to member
    const taskRes = await fetch(`${gatewayBaseUrl}/api/core/committees/${committeeId}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${leadAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Build PyTorch Model',
        description: 'Complete hands-on image classifier workshop',
        assigneeUserId: 'member-ai-1',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    assert.equal(taskRes.status, 201);
    const { task } = await taskRes.json();
    assert.equal(task.title, 'Build PyTorch Model');
    assert.equal(task.status, 'todo');

    // 3.3 Member moves task: todo -> in_progress
    const inProgressRes = await fetch(`${gatewayBaseUrl}/api/core/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${memberAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    assert.equal(inProgressRes.status, 200);
    const inProgressBody = await inProgressRes.json();
    assert.equal(inProgressBody.task.status, 'in_progress');

    // 3.4 Member moves task: in_progress -> done
    const doneRes = await fetch(`${gatewayBaseUrl}/api/core/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${memberAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(doneRes.status, 200);
    const doneBody = await doneRes.json();
    assert.equal(doneBody.task.status, 'done');

    // 3.5 Lead creates a new committee resource
    const resRes = await fetch(`${gatewayBaseUrl}/api/core/committees/${committeeId}/resources`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${leadAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Deep Learning Cheatsheet',
        url: 'https://docs.example.com/dl/cheatsheet',
        description: 'Reference formulas and architectures',
      }),
    });
    assert.equal(resRes.status, 201);

    // 3.6 Lead posts internal announcement
    const annRes = await fetch(`${gatewayBaseUrl}/api/core/committees/${committeeId}/announcements`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${leadAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Workshop Practice Session',
        body: 'Hands-on session on Friday 6 PM.',
      }),
    });
    assert.equal(annRes.status, 201);
  });

  test('Flow 4: HR Recruitment & Onboarding Complete Lifecycle', async () => {
    const adminAuth = await loginAs('admin@ieee.local');
    const applicantAuth = await loginAs('member.ai@ieee.local');
    const committeeId = IDS.committees.hr;

    // 4.1 Admin/HR creates a recruitment campaign
    const now = Date.now();
    const campRes = await fetch(`${gatewayBaseUrl}/api/core/hr/campaigns`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        committeeId,
        title: 'Spring 2026 HR Recruitment',
        opensAt: new Date(now - 10000).toISOString(),
        closesAt: new Date(now + 86400000).toISOString(),
        status: 'open',
      }),
    });
    assert.equal(campRes.status, 201);
    const { campaign } = await campRes.json();

    // 4.2 Applicant submits application
    const appRes = await fetch(`${gatewayBaseUrl}/api/core/hr/applications`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${applicantAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        campaignId: campaign.id,
        answers: {
          motivation: 'Excited to contribute to IEEE Menoufia HR team',
          experience: 'Organized student workshops and interview sessions',
        },
      }),
    });
    assert.equal(appRes.status, 201);
    const { application } = await appRes.json();
    assert.equal(application.currentStage, 'applied');

    // 4.3 HR Lead moves candidate: applied -> screening -> interview -> final_review
    const s1 = await fetch(`${gatewayBaseUrl}/api/core/hr/applications/${application.id}/stage`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stage: 'screening', notes: 'Good profile' }),
    });
    assert.equal(s1.status, 200);

    const s2 = await fetch(`${gatewayBaseUrl}/api/core/hr/applications/${application.id}/stage`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stage: 'interview', notes: 'Scheduled interview' }),
    });
    assert.equal(s2.status, 200);

    const s3 = await fetch(`${gatewayBaseUrl}/api/core/hr/applications/${application.id}/stage`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stage: 'final_review', score: 92, notes: 'Passed interview with high score' }),
    });
    assert.equal(s3.status, 200);

    // 4.4 HR Lead accepts candidate -> generates onboarding checklist
    const acceptRes = await fetch(`${gatewayBaseUrl}/api/core/hr/applications/${application.id}/accept`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'Welcome to HR committee!' }),
    });
    assert.equal(acceptRes.status, 200);

    // 4.5 Verify onboarding items created for user
    const onbRes = await fetch(`${gatewayBaseUrl}/api/core/hr/onboarding/member-ai-1`, {
      headers: { authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(onbRes.status, 200);
    const onbBody = await onbRes.json();
    assert.ok(Array.isArray(onbBody.onboarding.items));
    assert.ok(onbBody.onboarding.items.length >= 4);

    // 4.6 Newly accepted member completes first onboarding checklist item
    const firstItem = onbBody.onboarding.items[0];
    const updateItemRes = await fetch(`${gatewayBaseUrl}/api/core/hr/onboarding/${firstItem.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${applicantAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(updateItemRes.status, 200);
    const updatedItem = await updateItemRes.json();
    assert.equal(updatedItem.item.status, 'done');

    // 4.7 Funnel summary report
    const repRes = await fetch(`${gatewayBaseUrl}/api/core/hr/reports/pipeline-summary`, {
      headers: { authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(repRes.status, 200);
    const repBody = await repRes.json();
    assert.ok(repBody.totals);
    assert.ok(repBody.stages);
    assert.equal(typeof repBody.totals.applications, 'number');
  });

  test('Flow 5: PR Broadcast & Media Operations Flow', async () => {
    const adminAuth = await loginAs('admin@ieee.local');
    const committeeId = IDS.committees.ai;

    // 5.1 Create PR public announcement
    const prAnnRes = await fetch(`${gatewayBaseUrl}/api/core/pr/announcements`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Annual IEEE Menoufia Tech Summit Announced!',
        body: 'Join us for 3 days of keynotes, workshops, and robotics competitions.',
        visibility: 'public',
        committeeId,
      }),
    });
    assert.equal(prAnnRes.status, 201);
    const { announcement } = await prAnnRes.json();
    assert.equal(announcement.visibility, 'public');

    // 5.2 Create Media Album and add assets
    const albumRes = await fetch(`${gatewayBaseUrl}/api/core/media/albums`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        committeeId,
        title: 'AI Workshop Highlights 2026',
        description: 'Photos and recap from the AI hands-on bootcamp',
      }),
    });
    assert.equal(albumRes.status, 201);
    const { album } = await albumRes.json();

    // 5.3 Add photo asset
    const assetRes = await fetch(`${gatewayBaseUrl}/api/core/media/albums/${album.id}/assets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        assetUrl: 'https://images.example.com/ai-bootcamp-1.jpg',
        assetType: 'image',
        caption: 'Attendees building machine learning models',
      }),
    });
    assert.equal(assetRes.status, 201);

    // 5.4 Publish Album
    const pubRes = await fetch(`${gatewayBaseUrl}/api/core/media/albums/${album.id}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(pubRes.status, 200);
    const pubBody = await pubRes.json();
    assert.equal(pubBody.album.status, 'published');

    // 5.5 Create Media Coverage Request
    const covRes = await fetch(`${gatewayBaseUrl}/api/core/media/coverage-requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        committeeId,
        mediaCommitteeId: IDS.committees.ai,
        title: 'Live Coverage for RAS Robotics Challenge',
        eventAt: new Date(Date.now() + 172800000).toISOString(),
        description: 'Need dedicated photo & video coverage for the arena finals.',
      }),
    });
    assert.equal(covRes.status, 201);
    const { request } = await covRes.json();
    assert.equal(request.status, 'requested');

    // 5.6 Update Coverage Request status: requested -> accepted
    const covUpdate = await fetch(`${gatewayBaseUrl}/api/core/media/coverage-requests/${request.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'accepted' }),
    });
    assert.equal(covUpdate.status, 200);
  });

  test('Flow 6: File Service & 5-Domain Integration (Avatars, Media, Resources, HR Resumes, Banners)', async () => {
    const adminAuth = await loginAs('admin@ieee.local');
    const memberAuth = await loginAs('member.ai@ieee.local');

    // 6.1 Get File Service Config & Credit Policy
    const cfgRes = await fetch(`${gatewayBaseUrl}/api/files/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.ok(Array.isArray(cfg.allowedFolders));
    assert.equal(cfg.creditSavingPolicy.autoFormat, true);
    assert.equal(cfg.creditSavingPolicy.autoQuality, true);

    // 6.2 Domain 1: Member Avatar Signature & Update Flow
    const avatarSigRes = await fetch(`${gatewayBaseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${memberAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        folder: 'avatars',
        resourceType: 'image',
      }),
    });
    assert.equal(avatarSigRes.status, 200);
    const avatarSig = await avatarSigRes.json();
    assert.equal(avatarSig.folder, 'ieee_portal/avatars');
    assert.equal(avatarSig.eager, 'f_auto,q_auto,c_fill,w_400,h_400,g_face');

    // Simulated uploaded avatar URL from client direct upload
    const mockAvatarUrl = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,w_400,h_400,g_face/ieee_portal/avatars/member-ai-pic.jpg';
    const avatarUpdateRes = await fetch(`${gatewayBaseUrl}/api/core/me/avatar`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${memberAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ avatarUrl: mockAvatarUrl }),
    });
    assert.equal(avatarUpdateRes.status, 200);
    const avatarUpdateBody = await avatarUpdateRes.json();
    assert.equal(avatarUpdateBody.avatarUrl, mockAvatarUrl);

    // Verify avatar appears in personal dashboard
    const dashRes = await fetch(`${gatewayBaseUrl}/api/core/me/dashboard`, {
      headers: { authorization: `Bearer ${memberAuth.token}` },
    });
    assert.equal(dashRes.status, 200);
    const dashBody = await dashRes.json();
    assert.equal(dashBody.user.avatarUrl, mockAvatarUrl);

    // 6.3 Domain 2: Media Album Direct Upload Signature & Asset Attachment
    const mediaSigRes = await fetch(`${gatewayBaseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        folder: 'media_albums',
        resourceType: 'image',
      }),
    });
    assert.equal(mediaSigRes.status, 200);
    const mediaSig = await mediaSigRes.json();
    assert.equal(mediaSig.folder, 'ieee_portal/media_albums');
    assert.equal(mediaSig.eager, 'f_auto,q_auto,c_limit,w_1920,h_1080');

    // 6.4 Domain 3: Committee Resource Direct Upload Signature & Attachment
    const resourceSigRes = await fetch(`${gatewayBaseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        folder: 'resources',
        resourceType: 'raw',
      }),
    });
    assert.equal(resourceSigRes.status, 200);
    const resourceSig = await resourceSigRes.json();
    assert.equal(resourceSig.folder, 'ieee_portal/resources');

    // 6.5 Domain 4: HR Application Resume Signature
    const resumeSigRes = await fetch(`${gatewayBaseUrl}/api/files/signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${memberAuth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        folder: 'applications',
        resourceType: 'raw',
      }),
    });
    assert.equal(resumeSigRes.status, 200);
    const resumeSig = await resumeSigRes.json();
    assert.equal(resumeSig.folder, 'ieee_portal/applications');

    // 6.6 Server-side multipart upload fallback
    const formBoundary = '----WebKitFormBoundaryTestPortal';
    const bodyParts = [
      `--${formBoundary}`,
      'Content-Disposition: form-data; name="folder"',
      '',
      'resources',
      `--${formBoundary}`,
      'Content-Disposition: form-data; name="file"; filename="syllabus.pdf"',
      'Content-Type: application/pdf',
      '',
      'IEEE Menoufia Syllabus Content',
      `--${formBoundary}--`,
    ].join('\r\n');

    const upRes = await fetch(`${gatewayBaseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAuth.token}`,
        'content-type': `multipart/form-data; boundary=${formBoundary}`,
      },
      body: bodyParts,
    });

    assert.equal(upRes.status, 201);
    const upBody = await upRes.json();
    assert.equal(upBody.success, true);
    assert.ok(upBody.file.secureUrl);
  });
});

