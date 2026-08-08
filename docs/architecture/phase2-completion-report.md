# Phase 2 completion report

## Source of truth and resulting model

`ApprovalRouteResolver` is the source of truth for immutable grouped route snapshots. `ApprovalEngine` is the source of truth for versioned approval creation, group activation, decisions, advancement, reassignment, and supersession. `requestLifecycleService` remains the only canonical final request-state transition path, while the audit and notification outbox services provide transactional side effects.

Before this correction, the resolver rejected any two steps at one level, the engine inserted with a level-only conflict target, activated one row, and advanced after any member approval. Afterward, distinct members at one level are retained and activated together; progression remains sequential between levels and waits for unanimous approval inside the current level. One rejection or return ends the current cycle.

## Route safety and concurrency

Canonical reads exclude superseded rows and scope to an explicit version, snapshot, or legacy identity without mixing them. Creation uses `(request_id, approval_route_version, approval_level, approver_id)`. Reclassification continues to allocate monotonically increasing versions and preserve replaced rows.

Decision and reassignment transactions lock the request first and workflow rows in `(approval_level, id)` order. Completion is derived after the individual write. This serializes concurrent final approvals and makes level activation, final lifecycle transition, audit, and outbox insertion atomic. Newly activated members receive deterministic per-member notifications.

## Bounded legacy updates and remaining debt

Actionable reads touched in request fetch/update/create, approval, and dashboard controllers now exclude superseded rows. History queries intentionally retain them. The following legacy writes remain outside `ApprovalEngine` and must be consolidated later:

- `controllers/approvalsController.js`: main decision implementation, routed-HOD SCM delegation, email decision, hold/resume, and direct next-level activation.
- `controllers/requests/updateRequestsController.js`: item-aware approval, direct activation/insertion, edit restart, reassignment, and requester reassignment.
- `controllers/requests/createRequestController.js` and `controllers/utils/initializeApprovals.js`: legacy role resolution/insertion and initial activation.
- reminder and bulk reassignment utilities: direct operational updates.

The legacy SCM → HOD → SCM sequence remains explicitly outside the parallel group model. Several old UI projections still expose a single display name for a current level even though actionable lists support multiple rows; a future response contract should expose a member array. Role resolution also still chooses one user per configured role rule and should eventually become an explicit administrative membership operation.

## Migration and verification

Migration 003 was aligned to the approval-member identity and no longer enforces one active approval per request. It remains manual and was not executed. Run schema prerequisites in numeric order, apply `003_request_reclassification_and_uom.sql` during a quiet window, retain its validation results, and deploy this compatible application revision only after migration success.

Automated verification covers route grouping, database identity text, superseded safety, group activation, progression, terminal decisions, reassignment conflicts, transactional failure propagation, metadata, and per-member idempotent notification identity. No Supabase connection or SQL execution is part of the test procedure.