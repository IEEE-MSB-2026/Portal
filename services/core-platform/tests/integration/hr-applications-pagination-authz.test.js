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

test('hr applications: pagination (page, limit), default unlimited, and committee lead access', async () => {
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

    // 2. Insert 55 applications
    for (let i = 1; i <= 55; i++) {
      const applicantUserResult = await query(
        `
          INSERT INTO users (name, email, is_active)
          VALUES ($1, $2, TRUE)
          RETURNING id
        `,
        [`Applicant ${i}`, `applicant_${i}@test.com`]
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

    // 3. Committee Lead calls listApplications:
    // This exercises authzService.isCommitteeLead(req.identity, campaign.committee_id)
    const leadHeaders = signedHeaders({
      method: 'GET',
      path: '/core/hr/applications',
      userId: IDS.users.leadAi,
      userRole: 'lead',
      scopeType: 'committee',
      scopeId: IDS.committees.ai,
    });

    // A. Default request (no limit, no page) -> returns ALL 55 applications
    const defaultRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(defaultRes.status, 200);
    const defaultBody = await defaultRes.json();
    assert.equal(defaultBody.applications.length, 55);
    assert.equal(defaultBody.total, 55);
    assert.equal(defaultBody.pagination.total, 55);
    assert.equal(defaultBody.pagination.limit, null);
    assert.equal(defaultBody.pagination.totalPages, 1);
    assert.equal(defaultBody.pagination.hasNextPage, false);

    // B. Page 1 with limit 20 -> 20 items, totalPages = 3, hasNextPage = true
    const p1Res = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&page=1&limit=20`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(p1Res.status, 200);
    const p1Body = await p1Res.json();
    assert.equal(p1Body.applications.length, 20);
    assert.equal(p1Body.pagination.page, 1);
    assert.equal(p1Body.pagination.limit, 20);
    assert.equal(p1Body.pagination.totalPages, 3);
    assert.equal(p1Body.pagination.hasNextPage, true);
    assert.equal(p1Body.pagination.hasPrevPage, false);

    // C. Page 2 with limit 20 -> 20 items
    const p2Res = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&page=2&limit=20`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(p2Res.status, 200);
    const p2Body = await p2Res.json();
    assert.equal(p2Body.applications.length, 20);
    assert.equal(p2Body.pagination.page, 2);
    assert.equal(p2Body.pagination.hasNextPage, true);
    assert.equal(p2Body.pagination.hasPrevPage, true);

    // D. Page 3 with limit 20 -> remaining 15 items
    const p3Res = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&page=3&limit=20`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(p3Res.status, 200);
    const p3Body = await p3Res.json();
    assert.equal(p3Body.applications.length, 15);
    assert.equal(p3Body.pagination.page, 3);
    assert.equal(p3Body.pagination.hasNextPage, false);
    assert.equal(p3Body.pagination.hasPrevPage, true);

    // E. Page 2 without limit -> defaults to limit 50, remaining 5 items
    const p2NoLimitRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&page=2`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(p2NoLimitRes.status, 200);
    const p2NoLimitBody = await p2NoLimitRes.json();
    assert.equal(p2NoLimitBody.applications.length, 5);
    assert.equal(p2NoLimitBody.pagination.page, 2);
    assert.equal(p2NoLimitBody.pagination.limit, 50);

    // F. Invalid page (< 1) returns 400
    const invalidPageRes = await fetch(
      `${getBaseUrl(server)}/core/hr/applications?campaignId=${campaignId}&page=0`,
      { method: 'GET', headers: leadHeaders }
    );
    assert.equal(invalidPageRes.status, 400);

  } finally {
    server.close();
  }
});
