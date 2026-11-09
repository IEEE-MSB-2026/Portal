const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IDS,
  createServer,
  getBaseUrl,
  prepareDatabase,
  query,
  setupTestEnv,
  signedHeaders,
} = require('./helpers');

setupTestEnv();
const app = require('../../src/app');

function isoHoursFromNow(hours) {
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
}

test('hr applications: pagination, views (active, rejected, accepted, all), rejection metadata, and search', async () => {
  await prepareDatabase();
  const server = await createServer(app);

  try {
    // 1. Create a campaign linked to AI committee
    const campaignResult = await query(
      `
        INSERT INTO hr_campaigns (id, title, status, opens_at, closes_at, committee_id, created_by_user_id, form_schema)
        VALUES (
          'fb66267c-a04d-46aa-bad6-646fc8d9a076',
          'AI Committee Recruitment',
          'open',
          $1,
          $2,
          $3,
          $4,
          '{"fields":[]}'
        )
        RETURNING id
      `,
      [isoHoursFromNow(-2), isoHoursFromNow(48), IDS.committees.ai, IDS.users.officer]
    );
    const campaignId = campaignResult.rows[0].id;

    // 2. Insert 50 active applications
    for (let i = 1; i <= 50; i++) {
      const applicantUserResult = await query(
        `
          INSERT INTO users (name, email, is_active)
          VALUES ($1, $2, TRUE)
          RETURNING id
        `,
        [`Applicant Active ${i}`, `applicant_active_${i}@test.com`]
      );
      const applicantUserId = applicantUserResult.rows[0].id;

      await query(
        `
          INSERT INTO hr_applications (campaign_id, committee_id, applicant_user_id, current_stage, answers)
          VALUES ($1, $2, $3, 'applied', '{}')
        `,
        [campaignId, IDS.committees.ai, applicantUserId]
      );
    }

    // 3. Insert 3 rejected applications with rejection audit logs
    for (let i = 1; i <= 3; i++) {
      const applicantUserResult = await query(
        `
          INSERT INTO users (name, email, is_active)
          VALUES ($1, $2, TRUE)
          RETURNING id
        `,
        [`Rejected Candidate ${i}`, `rejected_${i}@test.com`]
      );
      const applicantUserId = applicantUserResult.rows[0].id;

      const appResult = await query(
        `
          INSERT INTO hr_applications (campaign_id, committee_id, applicant_user_id, current_stage, answers)
          VALUES ($1, $2, $3, 'rejected', '{"fullName": "Rejected Candidate ${i}"}')
          RETURNING id
        `,
        [campaignId, IDS.committees.ai, applicantUserId]
      );
      const appId = appResult.rows[0].id;

      await query(
        `
          INSERT INTO hr_application_stage_log (id, application_id, from_stage, to_stage, notes, actor_user_id)
          VALUES (gen_random_uuid(), $1, 'screening', 'rejected', $2, $3)
        `,
        [appId, `Not enough experience for level ${i}`, IDS.users.officer]
      );
    }

    // 4. Insert 2 accepted applications
    for (let i = 1; i <= 2; i++) {
      const applicantUserResult = await query(
        `
          INSERT INTO users (name, email, is_active)
          VALUES ($1, $2, TRUE)
          RETURNING id
        `,
        [`Accepted Candidate ${i}`, `accepted_${i}@test.com`]
      );
      const applicantUserId = applicantUserResult.rows[0].id;

      await query(
        `
          INSERT INTO hr_applications (campaign_id, committee_id, applicant_user_id, current_stage, answers)
          VALUES ($1, $2, $3, 'accepted', '{"fullName": "Accepted Candidate ${i}"}')
        `,
        [campaignId, IDS.committees.ai, applicantUserId]
      );
    }

    // Total created: 50 active + 3 rejected + 2 accepted = 55 total applications.

    // Headers for Committee Lead:
    const leadHeaders = signedHeaders({
      method: 'GET',
      path: '/core/hr/applications',
      userId: IDS.users.leadAi,
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    // A. Default request (view=active) -> returns 50 active applications (no rejected, no accepted)
    const activeRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(activeRes.status, 200);
    const activeBody = await activeRes.json();
    assert.equal(activeBody.applications.length, 50);
    assert.equal(activeBody.total, 50);
    assert.ok(activeBody.applications.every((a) => a.currentStage !== 'rejected' && a.currentStage !== 'accepted'));

    // B. view=rejected -> returns exclusively the 3 rejected applications with rejection notes and date
    const rejRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=rejected`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(rejRes.status, 200);
    const rejBody = await rejRes.json();
    assert.equal(rejBody.applications.length, 3);
    assert.equal(rejBody.total, 3);
    assert.ok(rejBody.applications.every((a) => a.currentStage === 'rejected'));
    assert.ok(rejBody.applications[0].rejectionNotes.includes('Not enough experience'));
    assert.ok(rejBody.applications[0].rejectedAt !== null);

    // C. view=accepted -> returns exclusively the 2 accepted applications
    const accRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=accepted`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(accRes.status, 200);
    const accBody = await accRes.json();
    assert.equal(accBody.applications.length, 2);
    assert.equal(accBody.total, 2);
    assert.ok(accBody.applications.every((a) => a.currentStage === 'accepted'));

    // D. view=all -> returns all 55 applications across all stages
    const allRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=all`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(allRes.status, 200);
    const allBody = await allRes.json();
    assert.equal(allBody.applications.length, 55);
    assert.equal(allBody.total, 55);

    // E. Specific stage parameter (stage=rejected) -> overrides view to return rejected
    const stageRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&stage=rejected`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(stageRes.status, 200);
    const stageBody = await stageRes.json();
    assert.equal(stageBody.applications.length, 3);

    // F. Server-side search for rejected candidate
    const searchRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=rejected&search=Candidate 2`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.equal(searchBody.applications.length, 1);
    assert.equal(searchBody.applications[0].applicantEmail, 'rejected_2@test.com');

    // G. Pagination: view=all, page=1, limit=20
    const p1Res = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=all&page=1&limit=20`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(p1Res.status, 200);
    const p1Body = await p1Res.json();
    assert.equal(p1Body.applications.length, 20);
    assert.equal(p1Body.pagination.page, 1);
    assert.equal(p1Body.pagination.totalPages, 3);
    assert.equal(p1Body.pagination.hasNextPage, true);

    // H. Invalid view returns 400
    const invalidViewRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&view=invalid_view`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(invalidViewRes.status, 400);

  } finally {
    server.close();
  }
});
