# IEEE Menoufia SB Portal — Complete Backend API Catalog by Flow

This document details every backend endpoint across all microservices (`Gateway`, `Core-Platform`, `Event-Register`, `Email-Service`), grouped by business flow.

---

## Architecture Service Prefix Summary
- **Gateway (Port 4000)**: Entry point for the frontend (`/api/auth/*`, `/api/core/*`, `/api/events/*`).
- **Core Platform (Port 3000)**: Postgres-backed core business domain (`/core/*`, `/public/*`).
- **Event Register (Port 5050)**: Mongo-backed registration and QR attendance engine (`/api/v1/events/*`).
- **Email Service (Port 3060)**: Redis-backed transactional email delivery engine (`/email/*`).

---

## 1. Authentication & Identity Flow (Gateway)

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/personas` | Public | List demo personas (Admin, Officer, Leads, Members, Volunteer, Scanners) |
| `POST` | `/api/auth/login` | Public | Authenticate user with email & password, returns JWT token |
| `POST` | `/api/auth/register` | Public | Register a new user account with role and optional committee scope |
| `GET` | `/api/auth/me` | Authenticated (Bearer) | Get current authenticated user profile and active claims |
| `POST` | `/api/auth/switch-context` | Authenticated (Bearer) | Switch active role or committee scope in the user session |

---

## 2. Public Portal & Visitor Content Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/core/public/committees` | Public / Visitor | Get all 7 public committee profiles (RAS, AI, Web, Cyber, HR, PR, Media) |
| `GET` | `/api/core/public/announcements` | Public / Visitor | Get published public announcements from branch leadership / PR |
| `GET` | `/api/core/media/albums?publishedOnly=true` | Public / Visitor | Browse published photo and video albums |
| `GET` | `/api/events` | Public / Visitor | Browse published and upcoming branch events |
| `GET` | `/api/events/:eventId` | Public / Visitor | Get single event details, activities, and schedule |

---

## 3. Member Personal Portal Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/core/me/dashboard` | Member+ | Aggregated personal dashboard (my profile with `avatarUrl`, committees, tasks, announcements) |
| `PATCH` | `/api/core/me/avatar` | Member+ | Update personal profile picture with uploaded Cloudinary avatar URL |
| `PATCH` | `/api/core/tasks/:taskId/status` | Assigned Member / Lead | Transition assigned task (`todo` -> `in_progress` -> `done`) |

---


## 4. Committee Workspaces Flow (RAS, AI, Web, Cyber, HR, PR, Media)

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/core/committees/:committeeId/workspace` | Committee Member+ | Get workspace dashboard, metrics, and member roster |
| `GET` | `/api/core/committees/:committeeId/memberships` | Committee Member+ | List members and leads of the committee |
| `POST` | `/api/core/committees/:committeeId/memberships` | Committee Lead / Admin | Add or update committee member role |
| `DELETE` | `/api/core/committees/:committeeId/memberships/:userId` | Committee Lead / Admin | Remove member from committee (cannot remove last lead unless admin) |
| `POST` | `/api/core/committees/:committeeId/tasks` | Committee Lead / Admin | Create task and assign to a verified committee member |
| `GET` | `/api/core/committees/:committeeId/resources` | Committee Member+ | List onboard/training documents and resource links |
| `POST` | `/api/core/committees/:committeeId/resources` | Committee Lead / Admin | Add new resource link/document to committee repository |
| `GET` | `/api/core/committees/:committeeId/announcements` | Committee Member+ | List internal announcements for committee |
| `POST` | `/api/core/committees/:committeeId/announcements` | Committee Lead / Admin | Post internal announcement with email notification dispatch |

---

## 5. HR Recruitment & Onboarding Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/core/hr/campaigns` | HR Lead / Admin | Create new recruitment campaign with target committee and dates |
| `PATCH` | `/api/core/hr/campaigns/:campaignId/status` | HR Lead / Admin | Open or close recruitment campaign |
| `POST` | `/api/core/hr/applications` | Public Applicant / Member | Submit application form for an open recruitment campaign |
| `GET` | `/api/core/hr/applications` | HR Lead / Admin | List applications (with filtering by campaign, stage, committee) |
| `PATCH` | `/api/core/hr/applications/:applicationId/stage` | HR Lead / Admin | Move candidate stage (`submitted` -> `screening` -> `interview`) |
| `POST` | `/api/core/hr/applications/:applicationId/accept` | HR Lead / Admin | Accept applicant: creates committee membership + onboarding checklist |
| `POST` | `/api/core/hr/applications/:applicationId/reject` | HR Lead / Admin | Reject applicant with rejection notes |
| `GET` | `/api/core/hr/onboarding/:userId` | Member (Self) / HR Lead | List onboarding items and checkboxes for newly accepted member |
| `PATCH` | `/api/core/hr/onboarding/:itemId` | Member (Self) / HR Lead | Check off onboarding item (`pending` -> `completed`) |
| `GET` | `/api/core/hr/reports/pipeline-summary` | HR Lead / Officer / Admin | Funnel summary: candidate counts per committee and stage |
| `GET` | `/api/core/hr/reports/pipeline-timeline` | HR Lead / Officer / Admin | Candidate progression velocity timeline report |

---

## 6. PR & Media Operations Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/core/pr/announcements` | PR Lead / Publisher / Admin | Create branch announcement (`internal` or `public`) |
| `GET` | `/api/core/pr/announcements` | Member+ | List internal & public PR announcements |
| `PATCH` | `/api/core/pr/announcements/:announcementId` | PR Lead / Publisher / Admin | Edit announcement |
| `DELETE` | `/api/core/pr/announcements/:announcementId` | PR Lead / Publisher / Admin | Delete announcement |
| `POST` | `/api/core/pr/campaigns` | PR Lead / Publisher / Admin | Draft email broadcast campaign targeting committee or all members |
| `GET` | `/api/core/pr/campaigns` | PR Lead / Publisher / Admin | List email broadcast campaigns |
| `POST` | `/api/core/pr/campaigns/:campaignId/send` | Publisher / Admin | Dispatch campaign through Email Service integration |
| `GET` | `/api/core/pr/campaigns/:campaignId/delivery` | PR Lead / Publisher / Admin | Track email delivery statistics and failure reasons |
| `POST` | `/api/core/media/albums` | Media Lead / Admin | Create media album |
| `GET` | `/api/core/media/albums` | Member+ | List media albums |
| `POST` | `/api/core/media/albums/:albumId/assets` | Media Lead / Admin | Add image/video assets to album |
| `POST` | `/api/core/media/albums/:albumId/publish` | Publisher / Admin | Publish media album to public website |
| `POST` | `/api/core/media/coverage-requests` | Committee Lead / Admin | Submit media coverage request for an upcoming workshop/activity |
| `PATCH` | `/api/core/media/coverage-requests/:requestId/status` | Media Lead / Admin | Update coverage status (`pending` -> `assigned` -> `completed`) |

---

## 7. Event Management, Registration & QR Scanner Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/events` | Event Organizer / Admin | Create new event |
| `GET` | `/api/events` | Public / All | List all events |
| `GET` | `/api/events/:eventId` | Public / All | Get event details |
| `DELETE` | `/api/events/:eventId` | Admin | Delete event |
| `POST` | `/api/events/:eventId/activities` | Organizer / Admin | Create sub-activity or workshop track |
| `GET` | `/api/events/:eventId/activities` | Organizer / Scanner / Admin | List activities for event |
| `GET` | `/api/events/:eventId/activities/:activityId` | Organizer / Scanner / Admin | Get activity details |
| `POST` | `/api/events/:eventId/participants` | Public / Organizer / Admin | Register participant (self or organizer entry) |
| `GET` | `/api/events/:eventId/participants` | Organizer / Admin | List registered attendees |
| `POST` | `/api/events/:eventId/participants/upload` | Organizer / Admin | Bulk upload attendees via CSV file |
| `GET` | `/api/events/:eventId/participants/:participantId` | Organizer / Admin | Get participant record and ticket ID |
| `POST` | `/api/events/:eventId/qr/send` | Organizer / Admin | Generate QR code tickets and email them to attendees |
| `POST` | `/api/events/:eventId/qr/scan` | Event Scanner / Admin | Scan QR ticket and record attendance (returns 409 if duplicate) |
| `GET` | `/api/events/:eventId/attendance/report` | Organizer / Admin | View attendance check-in metrics and percentages |
| `GET` | `/api/events/:eventId/attendance/export` | Organizer / Admin | Export sanitized CSV attendance file |

---

## 8. Transactional Email Service Flow

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/email/send` | Internal Microservice Auth | Send direct single email with HTML body or template |
| `POST` | `/email/bulk-template` | Internal Microservice Auth | Send bulk emails using a predefined template and recipient variables |
| `POST` | `/email/bulk-template-sheet` | Internal Microservice Auth | Bulk send to recipients parsed from uploaded CSV sheet |
| `GET` | `/health` | Public | Email service health check |

---

## 9. Governance, Routes Catalog & System Health

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/core/routes` | Member / Admin | Machine-readable API route contract catalog |
| `GET` | `/health` | Public | Gateway and downstream health probe |

---

## 10. File & Media Storage Service Flow (Cloudinary Presigned & Credit-Saving Upload)

*Destination Service: `file-service` (Port 5080 via Gateway `/api/files`)*

| Method | Endpoint Path | Access / Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/files/signature` | Authenticated / Applicant | Request direct Cloudinary presigned upload parameters & HMAC signature (injects `f_auto,q_auto,c_limit,w_1920,h_1080` to minimize credits). Offloads upload traffic to client. |
| `POST` | `/api/files/upload` | Authenticated / Member | Server-side multipart file upload fallback (checks credit limits: 5MB image, 15MB doc, 25MB video). |
| `GET` | `/api/files/config` | Public / Authenticated | Get allowed folder tags (`media_albums`, `resources`, `avatars`, `events`, `applications`), active cloud name, and credit saving policy. |
| `GET` | `/health` | Public | File service health status and Cloudinary connection mode (`cloudinary` or `local_mock`). |

