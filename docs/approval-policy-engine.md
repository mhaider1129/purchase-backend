# Approval Policy Engine 2.0: foundation and shadow mode

## Boundaries and lifecycle

Organization hierarchy answers **who reports to whom**; classification is metadata and never chooses a parent. Policy answers **which attestations a transaction requires**. A shadow snapshot records the people resolved at evaluation time, so later hierarchy, holder, department, or policy changes cannot rewrite history. Migration 014 must be manually applied before pending/manual migration 015; neither migration is runtime DDL.

## Applying the manual migrations

Run the complete files in numerical order against the same database and schema:

1. `sql/manual/014_organization_hierarchy.sql`
2. `sql/manual/015_approval_policy_engine_foundation.sql`

Operationalization migration `032_approval_engine_operationalization_phase1.sql`
must likewise be run as one complete file after migrations 014–016. Its preflight
recognizes and transactionally upgrades the earlier pending 032 revision that
created all three tables but neither guard function. Other partial or incompatible
shapes still fail closed rather than guessing how to repair unknown schema.

Do not run only a selected statement from either file: each migration includes its
own transaction and fail-closed preflight. If 015 reports
`SQL_015_REQUIRES_MANUALLY_APPLIED_SQL_014`, the target database does not contain
both prerequisite tables. Run the complete 014 file, confirm it commits without
`SQL_014_PARTIAL_OR_DRIFTED_SCHEMA`, and then rerun the complete 015 file. A notice
that 014 or 015 is already applied and compatible is a successful no-op.

To verify the prerequisite before retrying 015, run:

```sql
SELECT
  to_regclass('public.organization_units') AS organization_units,
  to_regclass('public.organization_positions') AS organization_positions;
```

Both result columns must be non-null. If either is null, do not bypass or remove
the 015 preflight: applying 014 is required because 015 creates foreign keys to
the organization hierarchy.

### Diagnosing `SQL_032_PARTIAL_OR_DRIFTED`

The exception's `DETAIL` identifies which of the three owned tables and two
owned functions are present when the installation is incomplete. If all five
objects are present, inspect the complete shape before making a repair:

If the detail reports exactly the three tables as present and both functions as
missing, rerun the updated complete 032 file. This is the recognized footprint of
the earlier pending 032 revision; the migration preserves existing rows, assigns
deterministic generation numbers and predecessor links, and installs the missing
constraints, indexes, functions, and triggers in the same transaction.

```sql
SELECT 'table' AS kind, c.relname AS object_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'approval_authority_delegations',
    'approval_route_snapshots',
    'approval_route_snapshot_steps'
  )
UNION ALL
SELECT 'function', p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'approval_route_snapshot_guard',
    'approval_route_snapshot_validate'
  )
ORDER BY kind, object_name;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'approval_authority_delegations',
    'approval_route_snapshots',
    'approval_route_snapshot_steps'
  )
ORDER BY table_name, ordinal_position;
```

Do not solve the guard by deleting whatever happens to be present. These tables
can contain delegation and immutable routing history. Compare the inventory with
the complete 032 file, back up affected data, and use a reviewed forward repair
for an older schema. If a complete-file attempt failed inside its transaction,
PostgreSQL rolls that attempt back; therefore surviving objects normally predate
that attempt and must be investigated rather than assumed disposable.

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

### Delegating an unstaffed structural position

An active, effective position can represent an authority even when `user_id` is
NULL. The organization authority service exposes this as `POSITION_UNSTAFFED`
with the position and unit identity intact. This status is structural context,
not a resolved user approver. The legacy holder-only adapters remain holder-only.

V2 shadow routing and simulation check an effective position delegation before
returning `UNRESOLVED`. A valid `PURCHASE_REQUEST_APPROVAL` delegation produces
`DELEGATED`, preserves the required position, and leaves the structural holder
NULL. Without an effective delegation the position is not routable. Ambiguous
positions fail closed before any delegation lookup; there is no executive
hierarchy fallback. Simulation evaluates both position dates and delegation
periods at its evaluation time. Delegation ranges are half-open (`from <= at < to`).

At `/admin/approval-delegations`, users with `approval-delegation.view` can view
institute delegations. Users who also have `approval-delegation.manage` can select
structural positions including those with no system user, create bounded
approval delegations, and revoke them with a reason. The server supplies selector
options from the authenticated institute; a position delegation needs no
frontend delegator user. Staffed positions retain their actual holder as context.
Existing holder validation, self-delegation, scope, overlap, audit and revocation
controls remain. Creation serializes delegation checks within an institute and
rejects one-hop chains regardless of edge creation order.

POSITION version readiness accepts an unstaffed position with an effective
delegation. Context-dependent resolvers such as EXECUTIVE_OWNER must be verified
with a department-specific simulation or shadow run; static version readiness
does not resolve request-specific ancestry. Organization holder health continues
to describe structural staffing rather than delegated acting approvers.

No new migration is required. Migration 032 already supports nullable
`delegator_user_id` and snapshot `structural_holder_id`. Route steps expose the
snapshot field names (`requiredAuthority`, `resolvedUnitId`,
`resolvedPositionId`, `structuralHolderId`, `actingApproverId`, `delegationId`,
`resolutionType`) so the internal snapshot append API preserves this provenance
without substituting the delegate as holder. No live routing or snapshot writes
are connected to request submission by this change.
