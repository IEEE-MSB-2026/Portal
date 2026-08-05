# PR Campaign Rollback Runbook

## Purpose
Operational guide for responding to incorrect or failed PR campaign dispatches in `core-platform`.

## Triggers
- Campaign dispatched to wrong segment.
- Campaign content issue discovered after send.
- Dispatch repeatedly failing and blocking communication timeline.

## Preconditions
- Operator has `publisher` or `admin` access.
- Incident ticket/reference ID opened.
- Target campaign ID identified.

## Immediate triage
1. Fetch delivery state:
   - `GET /core/pr/campaigns/:campaignId/delivery`
2. Confirm:
   - `status`
   - `dispatchRequestId`
   - `recipientCount`, `sentCount`, `failedCount`
   - latest dispatch attempt metadata

## Rollback strategy
1. If campaign is `failed`:
   - Correct campaign metadata (content/segment) out of band if needed.
   - Re-run send with `POST /core/pr/campaigns/:campaignId/send`.
2. If campaign is `sent` and message must be corrected:
   - Do not mutate historical send semantics.
   - Create a follow-up corrective campaign with explicit correction subject/body.
   - Dispatch corrective campaign to same segment (or narrower segment if needed).
3. If recipient targeting was wrong:
   - Create corrective campaign to intended audience.
   - Open data-quality action item for source segment assumptions.

## Verification checklist
1. Delivery endpoint shows expected status/counters after mitigation.
2. No duplicate unexpected dispatch attempts were produced.
3. Incident timeline records:
   - original campaign ID
   - corrective campaign ID (if created)
   - operator and timestamp

## Post-incident actions
1. Capture root cause (configuration, auth, content workflow, or segment logic).
2. Add/adjust tests if the failure mode was not covered.
3. Update operational notes and communicate closure with incident reference.
