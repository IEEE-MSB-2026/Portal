# Core Platform Service (Phase 03)

Core internal service for member workspaces.

## Scope in this phase
- Committee isolation enforcement
- Member dashboard aggregation
- Task assignment and status updates
- Committee resources, announcements, and memberships
- Best-effort email notifications for task assignment and committee announcements

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
- `EMAIL_SERVICE_URL`: base URL for `email-service` (example: `http://localhost:5060`)
- `EMAIL_SERVICE_AUTH_TOKEN`: service-to-service auth token sent as `x-service-token`
- `EMAIL_SERVICE_TIMEOUT_MS`: outbound timeout in milliseconds (default: `3000`)

Notifications are auto-enabled only when both `EMAIL_SERVICE_URL` and `EMAIL_SERVICE_AUTH_TOKEN` are configured.

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
- `GET /core/routes`

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
- Replay protection: request rejected if timestamp skew is greater than 60 seconds.

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
