# Current vs. historical approval query audit

This audit covers JavaScript SQL references to the request-workflow `approvals` table. Tables such as `contract_approvals`, `request_edit_approvals`, `non_po_receipt_approvals`, and JSON fields named `approvals` are separate domains and are out of scope. “Current” means a row can be acted upon, activated, counted as pending, reassigned, or reminded. Every such query must use `COALESCE(is_superseded, FALSE) = FALSE` (spacing/casing may vary).

## Current/actionable workflow

| File | Function/query purpose | Excludes superseded now? |
|---|---|---|
| `services/approvalEngine.js` | `supersedeWorkflow`, `activateNext`, `decide`, `reassign`; canonical Phase 2 workflow writes, active check, next-step selection, decision, and reassignment | Yes |
| `controllers/utils/initializeApprovals.js` | `initializeApprovals`; detects/creates current steps and activates the first Pending step | Yes for current existence/selection; inserts are new current rows |
| `controllers/utils/processScheduledRequests.js` | scheduled-request first Pending activation | Yes |
| `controllers/utils/remindPendingApprovals.js` | reminder queue | Yes |
| `controllers/utils/reassignPendingApprovals.js` | inactive-approver queue, reassignment, auto-approval, and next-level activation | Yes |
| `controllers/requests/fetchRequestsController.js` | pending approver lists, active joins, prior-step gating, maintenance approval queue, and actionable request filters | **Ambiguous legacy path; later conversion to `approvalEngine` required** |
| `controllers/requests/updateRequestsController.js` | legacy decision, next-step activation, ad-hoc approval insertion, edit restart, and direct reassignment | **Ambiguous legacy path; later conversion to `approvalEngine` required** |
| `controllers/approvalsController.js` | legacy approval decision/email decision, same-level/next-level activation, reminder, and routed-HOD handling | **Ambiguous legacy path; later conversion to `approvalEngine` required** |
| `controllers/requests/createRequestController.js` | duplicate checks, insertion, activation, and initial approver notification | **Ambiguous legacy path; later conversion to `approvalEngine` required** |
| `controllers/dashboardController.js` | pending/actionable dashboard counts and approver performance queries | **Mixed current and aggregate history; later query-by-query review required** |

The five corrected current paths above are the bounded Phase 2 correction. The remaining controller paths predate the canonical engine and are deliberately recorded rather than silently treating historical aggregates as actionable. They must not be used as evidence that superseded rows are actionable; Phase 3 should consolidate their writes behind `approvalEngine` and explicitly label each read.

## History/audit (superseded rows intentionally retained)

| File | Function/query purpose | Treatment |
|---|---|---|
| `controllers/approvalsController.js` | `getApprovalHistory`; ordered route/decision history | Includes superseded rows intentionally so reroutes remain auditable |
| `controllers/requests/requestWorkspaceController.js` | request workspace approval timeline | Includes superseded rows intentionally |
| `controllers/requests/printRequestController.js` | printable request approval trail | Includes superseded rows intentionally |
| `controllers/requests/fetchRequestsController.js` | request detail/progress/history projections | Includes superseded rows where a complete route record is expected; mixed functions remain flagged above |
| `controllers/dashboardController.js` | completed/final approval aggregates | Historical aggregates may include superseded rows; mixed pending queries remain flagged above |
| `services/requestReclassificationService.js` | `MAX(approval_route_version)` across all route generations | Includes superseded rows intentionally to allocate a monotonically increasing version |

Historical consumers should expose `is_superseded`, `superseded_at`, `superseded_reason`, and route version/snapshot identifiers when their response shape is next revised. They must never hide or delete the replaced route.

## Other references and classification

| File | Purpose | Classification |
|---|---|---|
| `controllers/requests/historicalRequestController.js` | import/reconstruction insertion | Historical |
| `routes/requests.js` | route-local approval lookup | Ambiguous; review with its owning endpoint |
| Tests under `tests/` and `__tests__/` | SQL mocks/assertions | Test-only |
| `sql/View_Supabase_SQL.sql` and manual SQL | schema definitions | Schema, not a runtime query |

## Permission catalog result

`requests.reclassify` has one definition in `CORE_PERMISSION_DEFINITIONS` and one assignment in `DEFAULT_ROLE_PERMISSIONS`: normalized default role `scm` (Supply Chain Manager). Runtime permission seeding is centralized in `utils/permissionService.js`; no role-name check authorizes reclassification.

## Invariant documented by migration 003

Migration 003 creates the versioned member identity `(request_id, approval_route_version, approval_level, approver_id)`. It deliberately has no one-active-approval-per-request or version/level-only unique invariant because both would prohibit parallel groups.