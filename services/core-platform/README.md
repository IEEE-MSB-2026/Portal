# Core Platform Service (Phase 05)

Core internal service for member workspaces, HR pipeline operations, PR messaging, and media workflows.

## Scope in current phase
- Committee isolation enforcement
- Member dashboard aggregation
- Task assignment and status updates
- Committee resources, announcements, and memberships
- Best-effort email notifications for task assignment and committee announcements
- HR campaign/application workflow, acceptance governance, IAM sync, onboarding APIs, and reporting
- PR announcement center (protected + public listing)
- PR campaigns with governed send and delivery tracking
- Media album workflow and coverage request lifecycle with task handoff

## Quick start
```bash
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

## Required environment variables
- `PORT`
- `DATABASE_URL`
- `CORE_GATEWAY_SHARED_SECRET`

## Optional notification environment variables
- `EMAIL_SERVICE_URL`: base URL for `email-service` (example: `http://localhost:3060`)
- `EMAIL_SERVICE_AUTH_TOKEN`: service token sent as `x-service-token`
- `EMAIL_SERVICE_TIMEOUT_MS`: outbound timeout in milliseconds (default: `3000`)

Notifications are auto-enabled only when both `EMAIL_SERVICE_URL` and `EMAIL_SERVICE_AUTH_TOKEN` are configured.

## Optional IAM and HR governance variables
- `IAM_SERVICE_URL`: base URL for IAM role assignment API (example: `http://localhost:5050`)
- `IAM_SERVICE_AUTH_TOKEN`: service token sent as `x-service-token`
- `IAM_SERVICE_TIMEOUT_MS`: outbound timeout in milliseconds (default: `3000`)
- `HR_ACCEPT_GOVERNANCE_MODE`: `mode_a` or `mode_b` (default: `mode_b`)

Acceptance is available only when both `IAM_SERVICE_URL` and `IAM_SERVICE_AUTH_TOKEN` are configured.
In `mode_b` only global `admin`/`officer` can accept; in `mode_a` HR managers (`lead` or privileged global) can accept.

## Optional PR and Media variables
- `PR_CAMPAIGN_MAX_RECIPIENTS`: hard guard on campaign send recipient size (default: `500`)
- `MEDIA_COMMITTEE_ID`: default media committee UUID used for coverage handoff when not overridden in request

## Endpoints
- `GET /health`
- `GET /health/db`
- `GET /core/me/dashboard`
- `GET /core/committees/:committeeId/workspace`
- `POST /core/committees/:committeeId/tasks`
- `PATCH /core/tasks/:taskId/status`
- `GET /core/committees/:committeeId/resources`
- `POST /core/committees/:committeeId/resources`
- `GET /core/committees/:committeeId/announcements`
- `POST /core/committees/:committeeId/announcements`
- `GET /core/committees/:committeeId/memberships`
- `POST /core/committees/:committeeId/memberships`
- `DELETE /core/committees/:committeeId/memberships/:userId`
- `POST /core/hr/campaigns`
- `PATCH /core/hr/campaigns/:campaignId/status`
- `POST /core/hr/applications`
- `GET /core/hr/applications`
- `PATCH /core/hr/applications/:applicationId/stage`
- `POST /core/hr/applications/:applicationId/accept`
- `POST /core/hr/applications/:applicationId/reject`
- `GET /core/hr/onboarding/:userId`
- `PATCH /core/hr/onboarding/:itemId`
- `GET /core/hr/reports/pipeline-summary`
- `GET /core/hr/reports/pipeline-timeline`
- `POST /core/pr/announcements`
- `GET /core/pr/announcements`
- `PATCH /core/pr/announcements/:announcementId`
- `DELETE /core/pr/announcements/:announcementId`
- `POST /core/pr/campaigns`
- `GET /core/pr/campaigns`
- `POST /core/pr/campaigns/:campaignId/send`
- `GET /core/pr/campaigns/:campaignId/delivery`
- `POST /core/media/albums`
- `GET /core/media/albums`
- `POST /core/media/albums/:albumId/assets`
- `POST /core/media/albums/:albumId/publish`
- `POST /core/media/coverage-requests`
- `PATCH /core/media/coverage-requests/:requestId/status`
- `GET /core/routes`
- `GET /public/pr/announcements`

## Governance Notes

### Announcement visibility
- PR announcements default to `internal`.
- Only records with `visibility=public` and not deleted are returned by `GET /public/pr/announcements`.

### Campaign send governance
- Campaign send route `POST /core/pr/campaigns/:campaignId/send` is restricted to `publisher` or `admin`.
- Repeated send on already `sent` campaign is idempotent and does not trigger extra downstream dispatch.
- On downstream failure, campaign state moves to `failed` with delivery counters and safe error responses.

### Media album publish governance
- Media leads can create albums and add assets in committee scope they manage.
- Album publish route `POST /core/media/albums/:albumId/publish` is restricted to `publisher` or `admin`.

## Incident Runbook
- PR campaign rollback runbook: `services/core-platform/docs/pr-campaign-rollback-runbook.md`

## Gateway trust contract
Required headers for all `/core/*` routes:
- `x-user-id`
- `x-user-email`
- `x-user-role`
- `x-scope-type`
- `x-scope-id`
- `x-gateway-timestamp`
- `x-gateway-signature`

Signature payload format:
```text
method\npath\nx-user-id\nx-user-role\nx-scope-type\nx-scope-id\nx-gateway-timestamp
```

- Algorithm: HMAC-SHA256
- Replay protection: request rejected if timestamp skew is greater than 60 seconds
- Role aliases accepted for compatibility:
  - `organizer` -> `event_organizer`
  - `scanner` -> `event_scanner`
  - `content_editor` -> `editor`

## Signed request example
```js
const { buildGatewaySignedHeaders } = require('./src/auth/gatewayContract');

const headers = buildGatewaySignedHeaders({
  method: 'GET',
  path: '/core/me/dashboard',
  userId: 'member-ai-1',
  userEmail: 'member.ai@ieee-menofia.local',
  userRole: 'member',
  scopeType: 'committee',
  scopeId: '00000000-0000-0000-0000-000000000001',
  secret: process.env.CORE_GATEWAY_SHARED_SECRET,
});
```

## Docker compose
```bash
docker compose up --build
```

## Test
```bash
npm test
```
