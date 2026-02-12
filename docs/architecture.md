# IEEE Menoufia SB Portal — Architecture v2 (IAM/RBAC Service + Core Platform Service)
Date: 2026-02-11  
Purpose: Update the architecture so **Portal API becomes an Auth/RBAC service (IAM + Gateway)**, while all business modules move to a **separate Core service**.

---

## 1) Architecture Decision (What changed)
### New rule
- **Portal API** is responsible for:
  - Authentication (login/session/token)
  - RBAC (multi-role + scoped roles)
  - Role assignment administration
  - Authorization enforcement at the edge (gateway)
  - (Optional) centralized authorization decisions

- **Core Platform Service** is responsible for:
  - Content (public site pages/posts)
  - Committees (workspaces)
  - Tasks
  - HR recruitment + onboarding
  - PR announcements + campaigns metadata
  - Media gallery + albums + coverage requests
  - Portal event catalog + mapping to Event Service IDs
  - Audit logs for business actions (optional split)

Existing microservices remain separate:
- Event Registration Service
- Email Service
- Chat Service (optional)

---

## 2) High-level diagram

```

[ Browser (Next.js Web App) ]
|
| HTTPS (cookie/session or access token)
v
[ Portal IAM + Gateway Service ]  ----->  [ IAM DB (Postgres) ]
|
| Internal HTTPS (mTLS recommended)
v
[ Core Platform Service ]  ----------->  [ Core DB (Postgres) ]
|
+----> [ Event Service (MongoDB) ]
|
+----> [ Email Service (Redis Stream + HTTP fallback) ]
|
+----> [ Chat Service (optional) ]

```

**Client rule:** Frontend talks only to **Portal IAM + Gateway**.

---

## 3) Services and Responsibilities

### 3.1 Portal IAM + Gateway Service (new “Portal API” role)
**Primary responsibilities**
- Authentication:
  - Login / logout
  - Session management (cookie) OR OAuth/OIDC-style tokens
  - Refresh tokens if using JWT access tokens
- RBAC:
  - Roles, scoped assignments (GLOBAL/COMMITTEE/EVENT)
  - “My roles” resolution (union of roles)
- Gateway / Edge enforcement:
  - Validate identity on every request
  - Enforce authorization for routes (coarse-grained)
  - Forward requests to Core with user context
- Admin:
  - Manage users (invite/disable)
  - Assign roles
  - View auth-related audit logs

**Optional (recommended for complex rules)**
- Authorization Decision API (central PDP):
  - Core calls IAM to ask “can user X do action Y on resource Z?”
  - Cache decisions short-term

---

### 3.2 Core Platform Service (business modules)
**Modules inside Core**
- Content Module: pages/posts, draft workflow, publishing state
- Committee Module: committee definitions, workspace, members (membership mapping)
- Task Module: tasks, assignments, statuses
- HR Module: campaigns, applications pipeline, onboarding checklist
- PR Module: announcements (data), campaign definitions, segments (data)
- Media Module: assets metadata, albums, coverage requests, approvals
- Events Module:
  - Portal-side event metadata + mapping to Event Service `event_service_event_id`
  - Calls Event Service for registrations, attendees, scanning actions (through server-side adapter)
- Audit Module (business actions):
  - publish/unpublish, exports, acceptance decisions, etc.

**Important**
- Core does **NOT** implement login or store credentials.
- Core assumes identity is already validated by IAM Gateway.

---

### 3.3 Existing Microservices (unchanged)
- **Event Service**: registrations, QR, check-in, activities
- **Email Service**: send/bulk campaigns + async consumer
- **Chat Service (optional)**: channels/messages/presence

---

## 4) Data Ownership (Source of truth)

### IAM DB (Postgres) owns
- Users identity records (and/or references to external identity provider)
- Credentials (if not using external IdP)
- Role definitions
- Role assignments with scope:
  - `scope_type = GLOBAL | COMMITTEE | EVENT`
  - `scope_id`
- Auth audit logs:
  - login/logout
  - role assignment changes
  - user disable/enable

### Core DB (Postgres) owns
- Committees, committee workspace content
- Tasks, resources, announcements
- Content pages/posts + revisions
- HR pipeline + onboarding checklist
- PR announcements data + campaign metadata
- Media albums + asset metadata
- Portal events catalog + mapping to event-service IDs
- Business audit logs (publish, exports, HR accept/reject, etc.)

### Event Service DB (Mongo) owns
- Registrations, activities, participants, check-ins

---

## 5) Request Flow (How frontend and backend interact)

### 5.1 Standard request flow
1) Browser calls `https://portal.example.com/api/...`
2) **IAM Gateway**:
   - validates session/token
   - checks RBAC (coarse-grained)
   - forwards to Core: `http(s)://core.internal/...`
3) Core processes request, hits Core DB, calls other services if needed
4) Response returns to browser through gateway

### 5.2 User context propagation (IMPORTANT)
Gateway forwards **verified user context** to Core, e.g.:
- `X-User-Id`
- `X-User-Email`
- `X-Roles` (or JWT claims)
- `X-Scope-Claims` (committee/event scopes)

**Spoofing prevention**
Core must only accept these headers if the request is from the Gateway:
- internal network allowlist OR mTLS
- optionally add `X-Gateway-Signature` (HMAC over user context + timestamp)

---

## 6) Authorization Model (How permissions are enforced)

### Option A (recommended): JWT claims + enforcement in Core (PEP)
- IAM issues a short-lived **Access Token (JWT)** containing:
  - user_id
  - global roles
  - scoped roles summary (committee/event claims)
- Gateway validates JWT and forwards it to Core
- Core verifies JWT signature and enforces permissions per endpoint

**Pros:** fast, fewer network calls  
**Cons:** claims can become stale until token refresh

Use short expiry (e.g., 10–15 minutes) + refresh flow.

---

### Option B: Central authorization decisions (IAM = PDP)
- Core calls IAM endpoint:
  - `POST /authorize` with `{ user_id, action, resource_type, resource_id, context }`
- IAM returns allow/deny (and reason)
- Core caches decisions briefly (e.g., 30–120 seconds)

**Pros:** always up-to-date, best for complex rules  
**Cons:** adds latency + dependency on IAM availability

---

### Hybrid approach (best practice)
- Use **Option A** for most endpoints (roles/scopes in JWT)
- Use **Option B** only for:
  - sensitive actions (exports, publishing, role changes)
  - complex rules (workflow approvals)

---

## 7) API Boundaries (Who exposes what)

### 7.1 Gateway public API surface (what frontend calls)
The frontend calls only the gateway domain. Two patterns are acceptable:

#### Pattern 1: Gateway = reverse proxy (thin)
- Gateway exposes `/core/*` and proxies to Core
- RBAC enforced at gateway edge + Core validates token again

#### Pattern 2: Gateway = BFF (recommended later)
- Gateway provides consolidated endpoints that combine Core + Event service views
- Fewer round trips and simpler frontend

Start with Pattern 1 to move fast.

---

## 8) Endpoint outlines (Codex reference)

### 8.1 IAM + Gateway endpoints
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh` (if JWT access token)
- `GET  /auth/me`  (returns profile + roles summary)
- `GET  /admin/users`
- `POST /admin/users/invite`
- `PATCH /admin/users/:id/disable`
- `POST /admin/roles/assign` (scope-aware)
- `POST /authorize` (optional PDP endpoint)
- `GET  /audit/auth` (auth + role assignment logs)

**Gateway proxy**
- `/*` (route or prefix) → forwards to Core based on routing rules  
  Example: `/core/*` → Core Platform Service

---

### 8.2 Core Platform endpoints (internal, but reachable via gateway)
- Content:
  - `GET /content/pages/:slug` (public)
  - `POST /content/drafts`
  - `POST /content/:id/publish`
- Committees:
  - `GET /committees` (public list)
  - `GET /committees/:id/public`
  - `GET /committees/:id/workspace` (protected)
- Tasks:
  - `POST /committees/:id/tasks`
  - `PATCH /tasks/:id/status`
- HR:
  - `POST /hr/campaigns`
  - `POST /hr/applications`
  - `PATCH /hr/applications/:id/stage`
  - `POST /hr/applications/:id/accept` (triggers role grant via IAM)
- Media:
  - `POST /media/assets`
  - `POST /media/albums`
  - `POST /media/albums/:id/publish`
- Events:
  - `POST /events` (create portal event record + map to event-service id)
  - `GET /events` (public)
  - `POST /events/:id/checkin` (scanner) → calls Event Service

**Cross-service call needed**
- HR accept/reject triggers an IAM call:
  - Core → IAM: `POST /admin/roles/assign` (or a dedicated service endpoint)

---

## 9) Frontend architecture (unchanged, but routing is cleaner)
**One Next.js app**
- Public pages + member area + ops dashboards
- All API calls go to gateway domain:
  - `/api/auth/*` for auth
  - `/api/core/*` (or direct) for business modules
- Route guards based on `/auth/me` role summary

---

## 10) Deployment Plan (Docker Compose MVP)
Services:
- `web` (Next.js)
- `iam-gateway` (Portal API)
- `core` (Core Platform Service)
- `iam-db` (Postgres)
- `core-db` (Postgres)
- `redis` (optional, caching + background jobs)
- existing: `event-service`, `email-service`, optional `chat-service`
- `reverse-proxy` (nginx/caddy) → routes:
  - `/` → web
  - `/api` → iam-gateway
  - core only reachable from internal network (recommended)

---

## 11) Security Checklist (must implement)
- Gateway validates session/token for all protected routes
- Core verifies forwarded identity:
  - only trust gateway via mTLS or internal allowlist
  - validate JWT again in Core (recommended)
- No microservice API keys exposed to browser
- Audit logs for:
  - role assignments
  - publish/unpublish
  - exports
  - HR accept/reject

---

## 12) Migration Steps (from monolith modules → Core service)
1) Implement IAM service first:
   - auth + RBAC + role assignment UI
2) Move business modules to Core service:
   - content + committees + tasks
3) Route frontend through gateway proxy
4) Add events adapter in Core
5) Add HR + PR/Media in Core
6) Optional: chat sync + AI later

---

## 13) Pros / Cons of this split

### Pros
- IAM logic centralized and reusable
- Core stays focused on business modules
- Cleaner security boundaries
- Easier to add more services later

### Cons
- More operational complexity than modular monolith
- Requires careful identity propagation (avoid spoofing)
- Potential latency if using central authorize endpoint heavily

Recommended mitigation:
- Use JWT claims for most checks + PDP only for complex/sensitive actions.

---

## 14) Codex Task Breakdown (what to build first)
1) IAM service: auth + RBAC + scoped assignments + `/auth/me`
2) Gateway proxy routing to Core
3) Core service skeleton + token validation middleware
4) Content module + committee public pages
5) Committee workspace + tasks + announcements
6) Events adapter + scanner flow
7) HR pipeline + accept triggers IAM role assignment
8) PR/Media modules



