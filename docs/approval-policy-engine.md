# Approval Policy Engine 2.0: foundation and shadow mode

## Boundaries and lifecycle

Organization hierarchy answers **who reports to whom**; classification is metadata and never chooses a parent. Policy answers **which attestations a transaction requires**. A shadow snapshot records the people resolved at evaluation time, so later hierarchy, holder, department, or policy changes cannot rewrite history. Migration 014 must be manually applied before pending/manual migration 015; neither migration is runtime DDL.

A stable policy owns immutable numbered versions. `DRAFT` is editable, `VALIDATED` has passed structural validation, `SHADOW` can be evaluated, and `ACTIVE`/`RETIRED` are future-compatible states. The backend constant `LIVE_ROUTING_ENABLED=false` means even an `ACTIVE` row is ignored by live routing. Changing a SHADOW-or-later version requires a new DRAFT.

## Controlled rules and facts

Rules use unique integer priority and AND their controlled conditions. Unknown evidence does not match. Supported conditions are request type, department, section, department classification, organization ancestor, exact-decimal amount bounds, stock/non-stock, maintenance, medical device, medical, and warehouse-required. There is no JavaScript, SQL, free-text inference, or executable JSON. `buildApprovalPolicyFacts` is the only request fact loader; absent amount or evidence remains `null`.

Resolvers are REQUESTER, DEPARTMENT_HEAD, SECTION_HEAD, EXECUTIVE_OWNER, POSITION, CAPABILITY_HOLDER, FIXED_USER/FIXED_AUTHORITY, and readable Supply Chain/COO/CEO/CFO/Warehouse/Medical Devices aliases. Organization resolvers delegate to the canonical hierarchy service. Capability and fixed-user resolution is institute-scoped and active-only; zero holders is UNRESOLVED and multiple holders is AMBIGUOUS.

## Composition and snapshots

Rules are evaluated by ascending priority. Every matching rule contributes steps until a matching `stop_processing` rule. Candidates sort by approval level, step order, then rule code, preserving parallel steps at one level and sequential levels. They are resolved, then only the same `resolved_user_id + semantic_key` is marked DEDUPLICATED. The same person with different semantic keys remains twice and is reported as DUPLICATE_PRINCIPAL.

A run snapshots facts and proposed steps, reads (never writes) authoritative `approvals`, and stores comparison differences. Legacy steps receive `LEGACY_SEMANTIC_UNKNOWN`; comparison conservatively uses user, level, and order and reports MATCH, missing/added, level/order/user differences, unresolved/ambiguous resolution, and duplicate principals. Aggregate outcomes are MATCH, PARTIAL_MATCH, DIFFERENT, UNRESOLVED, or ERROR.

Shadow generation may write only shadow tables (and coarse audit events when added). It cannot activate/complete approvals, update request status, email, notify, block, or progress a request. The existing `approvalEngine.js` remains authoritative and unchanged.

## Cutover (documentation only)

1. Run shadow only.
2. Compare a sufficient paginated sample of real requests.
3. Obtain policy and business signoff.
4. In a future phase, pilot by request type/department.
5. In a future phase, provide versioned live activation and rollback.

Stages 4 and 5 are deliberately not implemented.