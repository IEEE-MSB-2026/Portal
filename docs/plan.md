# IEEE Menoufia SB Portal — Master Plan
Goal: Build a student-activity portal for IEEE Menoufia Student Branch with committee workspaces + content + events ops + HR + PR/Media, with optional integrations to existing microservices (Event Registration, Email, Chat).

This document includes:
1) RBAC Permission Matrix (role → actions)  
2) Phased Backlog (what to build in order)  
3) User Stories + Acceptance Tests per phase  
4) Target Architecture (modules, boundaries, integrations)  
5) Extensive Execution Plan (deliverables, sprints, DoD, risks)

---

# 1) Roles (Multi-role + Scoped Assignments)

## 1.1 Roles (given)
- Branch Admin (Chair/Web master): everything
- Branch Officer (ExCom): committee operations, approvals
- Committee Lead: manage committee members, tasks, committee content
- Member/Volunteer: view internal, complete tasks
- Content Editor: create drafts
- Publisher: approve & publish (PR/Media leads typically)
- Event Organizer: event ops permissions
- Event Scanner: event ops permissions

## 1.2 Scope Types (required)
Role assignment can be:
- GLOBAL (applies everywhere)
- COMMITTEE (applies only to one committee: RAS/AI/Web/Cyber/HR/PR/Media)
- EVENT (applies only to one event)

Multi-role behavior:
- Effective permissions = UNION of all roles a user has (no deny rules in v1).

---

# 2) Committees
- RAS
- AI
- Web
- Cyber
- HR
- PR
- Media

Each committee gets:
- Public page (mission, highlights, join CTA)
- Internal workspace (members, tasks, resources, announcements, calendar)
- Request flows (to Web/Media/PR/HR as needed)

---

# 3) Resources & Actions Catalog (Authorization Targets)

## 3.1 Platform
- Manage users (invite/disable)
- Assign roles (global/committee/event)
- Manage portal settings (branding, seasons, committees)
- View audit logs

## 3.2 Committees (committee-scoped)
- View committee workspace
- Manage committee members
- Create/assign tasks
- Update task status
- Manage resources (docs/links)
- Internal announcements
- Edit committee public content (draft)

## 3.3 Content (public site)
- Create/edit draft
- Submit for review
- Approve
- Publish/unpublish
- Manage media assets

## 3.4 Events (event-scoped + integration)
- Create/update event metadata (portal-side)
- Publish event page
- Registration integration (redirect/call service)
- View registrations (and export)
- Send event emails (confirm/reminders)
- Attendance check-in (scan)
- Attendance reporting
- Certificate issuance

## 3.5 HR
- Recruitment campaign + application forms
- Review pipeline (stages, scoring)
- Accept/reject
- Onboarding checklist
- Evaluation + letters/certificates

## 3.6 PR/Media
- Announcements center
- Email campaigns/newsletter
- Gallery + albums
- Coverage requests + content calendar

## 3.7 Optional Chat
- Committee channels + membership sync
- Announcements channel
- Moderation

---

# 4) Permission Matrix (Role → Actions)

Legend:
✅ Allowed | ✅* Allowed but scoped | 🔒 Requires approval flow | ❌ Not allowed

## 4.1 Platform & Governance
| Action | Branch Admin | Branch Officer | Committee Lead | Member | Content Editor | Publisher | Event Organizer | Event Scanner |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Manage users (invite/disable) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign roles | ✅ | ✅ (committee/event only) | ✅* (committee only) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage portal settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View audit logs | ✅ | ✅ | ✅* (own committee) | ❌ | ❌ | ✅ | ✅* (own event) | ✅* (own event actions only) |

## 4.2 Committee Workspace (Scoped by committee)
| Action | Branch Admin | Branch Officer | Committee Lead | Member |
|---|---:|---:|---:|---:|
| View committee workspace | ✅ | ✅ | ✅ | ✅* |
| Manage committee members | ✅ | ✅ | ✅* | ❌ |
| Create/assign tasks | ✅ | ✅ | ✅* | ❌ |
| Update task status (own tasks) | ✅ | ✅ | ✅ | ✅ |
| Manage committee resources | ✅ | ✅ | ✅* | ✅* (read; optional upload) |
| Internal announcements | ✅ | ✅ | ✅* | ✅ (read) |

## 4.3 Content Workflow (Public Pages/Posts)
| Action | Branch Admin | Branch Officer | Committee Lead | Content Editor | Publisher | Member |
|---|---:|---:|---:|---:|---:|---:|
| Create/edit draft | ✅ | ✅ | ✅* (committee content only) | ✅ | ✅ | ❌ |
| Submit for review | ✅ | ✅ | ✅* | ✅ | ✅ | ❌ |
| Approve | ✅ | ✅ | 🔒 (optional; committee only) | ❌ | ✅ | ❌ |
| Publish/unpublish | ✅ | 🔒 (optional) | ❌ | ❌ | ✅ | ❌ |
| Manage media assets | ✅ | ✅ | ✅* | ✅ | ✅ | ❌ |

**Recommended v1:** Only Publisher/Admin can publish public content.

## 4.4 Events Ops (Scoped by event)
| Action | Branch Admin | Branch Officer | Event Organizer | Event Scanner | Member |
|---|---:|---:|---:|---:|---:|
| Create/update event | ✅ | ✅ | ✅* | ❌ | ❌ |
| Publish event page | ✅ | 🔒 (optional) | ✅* | ❌ | ❌ |
| View registrations | ✅ | ✅ | ✅* | ✅* (view-only) | ❌ |
| Export attendee list | ✅ | ✅ | ✅* | ❌ | ❌ |
| Send event emails | ✅ | ✅ | ✅* | ❌ | ❌ |
| Check-in scanning | ✅ | ✅ | ✅* | ✅* | ❌ |
| Attendance reports | ✅ | ✅ | ✅* | ✅* (read-only) | ❌ |
| Certificates issue | ✅ | ✅ | ✅* | ❌ | ✅ (self download) |

## 4.5 HR (Recruitment + Onboarding)
| Action | Branch Admin | Branch Officer | HR Lead (CommitteeLead scoped HR) | Member |
|---|---:|---:|---:|---:|
| Create recruitment campaigns/forms | ✅ | ✅ | ✅* | ❌ |
| View applications | ✅ | ✅ | ✅* | ❌ |
| Score/interview pipeline | ✅ | ✅ | ✅* | ❌ |
| Accept/reject | ✅ | ✅ | ✅* | ❌ |
| Onboarding checklist mgmt | ✅ | ✅ | ✅* | ✅ (self checklist) |
| Evaluations + letters/certs | ✅ | ✅ | ✅* | ✅ (receive) |

## 4.6 PR/Media
| Action | Branch Admin | Branch Officer | PR Lead (CL scoped PR) | Media Lead (CL scoped Media) | Publisher |
|---|---:|---:|---:|---:|---:|
| Create announcements | ✅ | ✅ | ✅* | ✅* | ✅ |
| Email campaigns/newsletter | ✅ | ✅ | ✅* | ❌ | ✅ |
| Gallery albums (create/edit) | ✅ | ✅ | ❌ | ✅* | ✅ |
| Coverage requests | ✅ | ✅ | ✅* (request) | ✅* (fulfill) | ✅ |

---

# 5) Approval Flows (Governance)

## 5.1 Content publishing (recommended)
Draft (Content Editor / Committee Lead) → Review (Officer optional) → Publish (Publisher/Admin)

## 5.2 Event publishing (choose one)
Option A (fast): Organizer can publish, Officer/Admin can unpublish  
Option B (strict): Organizer drafts → Officer/Admin approves publish

## 5.3 Recruitment acceptance (choose one)
Option A: HR Lead accepts, Officer can override  
Option B: HR Lead proposes, Officer approves

---

# 6) Phased Backlog (Epics → Deliverables)

## Phase 0 — Foundation
- Auth + Profiles
- Scoped RBAC engine + admin role assignment UI
- Audit log (role changes, publish/unpublish, event updates)
- Basic settings (committees list, season)

## Phase 1 — Public Site + Content
- Public pages: Home, About, Committees index, Contact
- Committee public pages (template)
- Content workflow: draft → review → publish
- Media upload (images)

## Phase 2 — Events Integration
- Events list + event page (public)
- Registration integration (existing service)
- Member: My Events/Tickets
- Organizer dashboard: attendees list + export + email reminders
- Scanner check-in page + attendance report

## Phase 3 — Member Portal + Committee Workspaces
- Member dashboard
- Committee workspace (tasks, resources, announcements, calendar)
- Lead can manage committee membership + roles (scoped)

## Phase 4 — HR Center
- Recruitment campaigns + forms
- Applications pipeline + scoring
- Accept/reject → auto role assignment + onboarding emails
- Onboarding checklist

## Phase 5 — PR + Media Ops
- Announcements center (internal + optional public)
- Email campaigns (segments)
- Gallery albums per event + publish flow
- Coverage requests + content calendar

## Phase 6 (Optional) — Chat Integration
- Committee channels auto-created
- Membership sync from RBAC
- Announcements channel + basic moderation

## Phase 7 (Optional) — AI Enhancements
- Knowledge base search
- Event/program recommendations
- Draft recaps assistance (human-edited)

---

# 7) USER STORIES + ACCEPTANCE TESTS (Per Phase)
Format:
- US-<phase>-<id>: User Story
- Acceptance Tests: Given / When / Then

## Phase 0 — Foundation
### US-0-1: Login + Profile
As a user, I want to log in and view my profile so I can access internal features.
- Given I am a registered user
  When I log in successfully
  Then I can view my profile page and session is active.

### US-0-2: Assign scoped roles
As a Branch Admin, I want to assign roles with scopes so permissions are correct.
- Given I am Branch Admin
  When I assign "Committee Lead" scoped to "AI" to a user
  Then that user can manage AI committee workspace but cannot manage other committees.

### US-0-3: Permission enforcement
As the system, I must block unauthorized actions to protect the portal.
- Given I am a Member without Publisher role
  When I try to publish a draft
  Then I receive "403 Forbidden" and the draft remains unpublished.

### US-0-4: Audit logging
As Branch Admin, I want to see an audit log so I can trace sensitive actions.
- Given an action "role assignment" happened
  When I open Audit Log
  Then I can see who did it, when, target user, and scope.

---

## Phase 1 — Public Site + Content
### US-1-1: Public committee pages
As a visitor, I want to view committee pages so I know what each committee does.
- Given committee pages exist and are published
  When I open Committees → AI
  Then I see mission, highlights, and join CTA.

### US-1-2: Draft content creation
As a Content Editor, I want to create drafts so content is prepared safely.
- Given I am Content Editor
  When I create a new draft page
  Then it is saved with status "Draft" and not visible publicly.

### US-1-3: Publish workflow
As a Publisher, I want to publish approved drafts so the public site updates.
- Given a draft exists
  When I publish the draft
  Then it becomes publicly visible and an audit log entry is created.

### US-1-4: Media asset upload
As Media/Publisher, I want to upload images so pages and gallery are rich.
- Given I have permission to manage assets
  When I upload an image
  Then it is stored, tagged, and usable in pages.

---

## Phase 2 — Events Integration
### US-2-1: View events
As a visitor, I want to see upcoming events so I can attend.
- Given events exist
  When I open Events
  Then I see a list with date/time/location and can open details.

### US-2-2: Register (integration)
As an attendee, I want to register for an event so I can receive my ticket/QR.
- Given registration is open
  When I click Register and complete registration (via existing service)
  Then I get confirmation and the portal shows "Registered" status.

### US-2-3: My Tickets
As a member, I want to see my tickets so I can access QR easily.
- Given I registered for an event
  When I open My Events/Tickets
  Then I can view/download my ticket/QR (or open the service link).

### US-2-4: Organizer attendee management
As an Event Organizer, I want to see attendees and export lists.
- Given I am Organizer scoped to Event X
  When I open Event X dashboard
  Then I can view attendee list and export CSV.

### US-2-5: Scanner check-in
As an Event Scanner, I want to scan QR and check-in attendees.
- Given I am Scanner scoped to Event X
  When I scan a valid attendee QR
  Then attendee is marked checked-in for the configured activity and the scan is logged.

### US-2-6: Attendance reporting
As an Organizer, I want attendance reports so I can generate certificates.
- Given check-ins occurred
  When I open Attendance Report
  Then I see counts and can export per activity/session.

---

## Phase 3 — Member Portal + Committee Workspaces
### US-3-1: Member dashboard
As a member, I want a dashboard so I can see my tasks and announcements.
- Given I am a logged-in member
  When I open Dashboard
  Then I see my committees, tasks assigned to me, and latest announcements.

### US-3-2: Committee workspace access control
As a committee member, I want to access my committee workspace only.
- Given I am a member of Cyber only
  When I open Cyber workspace
  Then I can view content
  And when I open AI workspace
  Then access is denied (403) unless I also have AI role.

### US-3-3: Task lifecycle
As a Committee Lead, I want to create and assign tasks so work is trackable.
- Given I am Lead of Web committee
  When I create a task and assign it to a member
  Then the member sees it on their dashboard and can update status.

### US-3-4: Resources library
As a committee, I want to store links/docs so onboarding is easy.
- Given I have resource permissions
  When I add a resource link in AI workspace
  Then AI members can view it and it appears in the workspace resources page.

### US-3-5: Internal announcements
As a lead/officer, I want to post internal announcements to coordinate the team.
- Given I am Committee Lead
  When I post an announcement in RAS
  Then RAS members see it in their feed and notifications (email optional).

---

## Phase 4 — HR Center
### US-4-1: Recruitment campaigns
As HR, I want to open/close recruitment campaigns so applications are controlled.
- Given a campaign has open/close dates
  When the date is outside the range
  Then application submission is blocked.

### US-4-2: Apply to committee
As a student, I want to apply to join a committee so I can volunteer.
- Given recruitment is open
  When I submit application to Media
  Then HR sees it in pipeline and I receive confirmation email.

### US-4-3: Review pipeline
As HR Lead, I want stages and scoring so selection is consistent.
- Given an application exists
  When I move it from Applied → Interview → Accepted
  Then the stage change is logged and visible to authorized staff.

### US-4-4: Accept triggers roles + onboarding
As HR, I want acceptance to grant access automatically.
- Given an applicant is accepted to PR
  When HR marks Accepted
  Then the user receives PR Member role (committee-scoped) and onboarding checklist is created.

### US-4-5: Onboarding checklist
As a new volunteer, I want a checklist so I can complete onboarding quickly.
- Given I was accepted
  When I open my onboarding checklist
  Then I can mark items complete and HR can see my progress.

---

## Phase 5 — PR + Media Ops
### US-5-1: Announcements (internal/public)
As PR, I want to post announcements so members stay informed.
- Given I am PR Lead or Publisher
  When I post an announcement as "Public"
  Then it appears on the public site announcements page.
- Given it is "Internal"
  Then only logged-in members can see it.

### US-5-2: Email campaigns
As PR, I want to send newsletters so I can reach targeted audiences.
- Given I select a segment (e.g., AI members + attendees of Event X)
  When I send a campaign
  Then emails are queued/sent via Email Service and delivery status is tracked (basic).

### US-5-3: Event gallery albums
As Media, I want to create albums per event so photos are organized.
- Given an event exists
  When I create an album and upload photos
  Then the album is visible internally until published by Publisher.

### US-5-4: Coverage requests workflow
As a committee, I want to request coverage so Media can plan content.
- Given I submit a coverage request for an event
  When Media accepts it
  Then tasks are created in Media workspace and deadlines appear on content calendar.

---

## Phase 6 (Optional) — Chat Integration
### US-6-1: Committee channels auto-sync
As a member, I want to join committee chat automatically.
- Given I am assigned AI committee role
  When my role is saved
  Then I am added to AI chat channel automatically.

### US-6-2: Moderation basics
As Admin/Cyber, I want moderation actions so abuse is controlled.
- Given a user posts prohibited content
  When a moderator deletes the message
  Then it is removed and logged in audit.

---

## Phase 7 (Optional) — AI Enhancements
### US-7-1: Knowledge base search
As a volunteer, I want to search policies/resources so I can find answers fast.
- Given resources exist
  When I search "certificate"
  Then relevant resources/pages are returned and ranked.

### US-7-2: Event recommendation
As a member, I want recommended events so I discover relevant activities.
- Given my interests are set to "Cyber"
  When I open Events
  Then recommended events show first with explanation tags (basic).

---

# 8) TARGET ARCHITECTURE (What to build + how it fits)

## 8.1 Architecture choice (recommended)
**Portal = Modular Monolith** (clean module boundaries)  
Optional Microservices (already existing): Event Registration, Email, Chat

Why:
- Faster delivery, simpler ops for a student branch
- Still scalable because modules are separated and integrations are adapter-based

## 8.2 High-level (C4-style: Context)
Users:
- Visitors
- Members/Volunteers
- Committee leads/officers/admin
External:
- Event Registration Service (existing)
- Email Service (existing internal)
- Chat Service (optional)

## 8.3 Containers
1) **Web App (Frontend)**
- Public site + Member area + Admin dashboards
- Talks to Portal API

2) **Portal API (Backend / BFF)**
- Implements RBAC, content, committees, HR, media, and adapters to services
- Owns Portal DB

3) **Portal DB**
- PostgreSQL recommended (RBAC, content, tasks, HR pipeline, gallery metadata)

4) **Cache/Queue (optional but recommended)**
- Redis: caching + async jobs (email triggers, imports)

5) **Existing Microservices**
- Event Service (registrations + check-in)
- Email Service (bulk + templates)
- Chat Service (committee comms)

## 8.4 Backend module boundaries (inside Portal API)
- Identity Module: users, profiles
- RBAC Module: roles, scopes, permission checks
- Content Module: pages/posts, drafts, publishing, media references
- Committee Module: committee workspace, members, announcements, resources
- Task Module: tasks, assignments, statuses
- Events Module (Adapter): portal events + mapping to event service IDs
- HR Module: recruitment campaigns, forms, pipeline, onboarding
- PR Module: announcements, campaigns, segmentation
- Media Module: albums, assets metadata, coverage requests
- Audit Module: logs, admin actions
- Notification Module (Adapter): email triggers

## 8.5 Integration pattern (adapters + webhooks)
- Portal should NOT duplicate microservice databases.
- Store “reference IDs”:
  - `event_service_event_id`
  - email templates IDs (if any)
  - chat channel IDs (if chat enabled)

Recommended:
- **Synchronous calls** for read operations (fetch event list/details)
- **Async jobs** for bulk (email campaigns, mass ticket resends)
- **Webhooks** from services → Portal (e.g., attendance updates) if available; otherwise poll/report import.

## 8.6 Security & Governance
- RBAC enforcement as middleware/guard on every API route
- Audit logs for sensitive actions (publish, role assignment, export)
- Rate limiting on public endpoints
- File upload rules (size limit, type whitelist)
- Secrets stored in env + not in repo

## 8.7 Observability (minimum)
- Structured logs
- Request IDs
- Error tracking (basic)
- Health endpoint for Portal API

---

# 9) EXTENSIVE EXECUTION PLAN (End-to-end)

## 9.1 Deliverables by milestone (what “done” means)
**Milestone A (MVP Public + RBAC):** Phase 0–1 complete  
**Milestone B (Events Ready):** Phase 2 complete  
**Milestone C (Internal Operations):** Phase 3–4 complete  
**Milestone D (Growth & Media):** Phase 5 complete  
**Milestone E (Optional):** Phase 6–7

## 9.2 Sprint-style breakdown (recommended)
Sprint 1: Phase 0 (Auth, RBAC, Admin, Audit)  
Sprint 2: Phase 1 (Public site, content workflow, committee pages)  
Sprint 3–4: Phase 2 (Events integration + scanner + reports)  
Sprint 5: Phase 3 (Member dashboard + committee workspaces + tasks)  
Sprint 6: Phase 4 (HR recruitment + pipeline + onboarding)  
Sprint 7: Phase 5 (PR campaigns + Media gallery + coverage flow)  
Sprint 8+: Optional chat/AI

(Adjust sprint length as needed; focus on shipping usable slices.)

## 9.3 Definition of Done (DoD) — apply to every feature
- Functional requirements met + RBAC enforced
- Unit tests for core logic OR e2e tests for critical flows
- Basic error handling + validation
- Audit log added for sensitive operations
- Documentation updated (routes, roles, how to use)
- UI states: loading/empty/error
- Review checklist passed (security + data scope)

## 9.4 Data model (minimum entities the portal MUST have)
- User, Profile
- Committee
- RoleAssignment (scoped)
- ContentItem (page/post), ContentRevision
- MediaAsset (metadata), Album
- Announcement
- Task, TaskAssignment
- RecruitmentCampaign, Application, ApplicationStageHistory
- OnboardingChecklist, OnboardingItem
- PortalEvent (maps to external event service ID)
- AuditLog

## 9.5 QA plan (minimum)
Critical paths to test every release:
- Login + role enforcement
- Publish flow (draft not visible until publish)
- Committee scope isolation
- Event scanner cannot scan other events
- Exports restricted to organizers/admin
- HR acceptance grants correct access

## 9.6 Risks & mitigations
- **Scope creep:** lock Phase 0–2 as “must-have”, others as “should-have”
- **Service integration gaps:** build adapters with feature flags + fallback (manual export/import)
- **Role mistakes:** enforce scope checks everywhere + audit logs
- **Data privacy:** minimal PII, consent for email campaigns, export permissions strict

## 9.7 Feature flags (recommended)
- enable_chat
- enable_ai_features
- strict_event_publish_approval
- strict_recruitment_approval

## 9.8 implementation guidance (how to split tasks)
1) RBAC core (scoped role assignments + guards)
2) Content workflow (draft/review/publish)
3) Committee module (workspace + tasks + announcements)
4) Events adapter + ops dashboards + scanner UI
5) HR module pipeline
6) PR/Media modules
7) Optional: chat sync + AI helpers

---

# 10) Final Notes
- Keep v1 **simple + enforce scopes** strictly.
- Prefer shipping “thin vertical slices”:
  (UI → API → DB → RBAC → audit) for each module.
- Integrations should be adapter-based so you can switch between “use the service” vs “portal-only fallback” when needed.
