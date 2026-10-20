# Dashboard active time and approval holds

Dashboard timing uses **active elapsed time**: calendar elapsed seconds minus
the union of recorded approval holds overlapping that measurement window.
For example, a 100-day PR-to-PO interval containing a 90-day hold reports 10 days.
It does not delete the request from reporting or change its real event dates.

## Affected reporting

- Lifecycle: PR to final approval, approval-level cumulative durations and
  bottleneck selection, PR to first PO/recorded procurement event.
- Dashboard summary: average approval duration, average pending age, oldest
  pending requests, and pending aging buckets.
- Workload: request waiting ages by user, approval level and department.
- Maintenance approval scorecards: server-provided active waiting seconds since
  recorded activation feed overdue filters, waiting bands and oldest-first sorting.
  Ages represent the latest server snapshot and refresh with request data.
- Maintenance/requested-item report exports: approval duration days use the same
  calculation. Individual audit timestamps remain actual calendar dates.

Existing KPI endpoints/status populations are retained. Approval-level lifecycle
bars remain cumulative from PR creation to that level's approval, now excluding
holds. Counts, financial totals, calendar/month filters, completion rates,
workflow permissions, reminders, priority scoring and original timestamps are
unchanged. The standalone procurement performance calculator is not a source of
these dashboards and remains a calendar milestone calculator.

## Interval rules and historical coverage

The SQL function reads `approval_logs` per approval. Hold starts are `On Hold`/
`Hold`; resume/pending/decision/supersession/cancellation state events close them.
Non-state logs such as reminders do not end a hold. Ordering uses event timestamp
and log ID for deterministic same-time events. Repeated hold events and parallel
approvers' intervals are merged before subtraction, so a day is deducted once.

Open holds end at the requested metric cutoff. A hold before or after the
measurement window contributes only its intersection. A recorded terminal
approval timestamp closes an unpaired hold when the corresponding closing log
is absent. Generic later `updated_at` edits are not treated as historical resume
proof. Closed unpaired holds without a known endpoint receive no inferred credit.
A currently active held approval without any hold log uses its current state
`updated_at` as the earliest known usable boundary; earlier time is not invented.
Historical holds with no recorded start cannot be reconstructed automatically.
Unknown/reversed endpoints return NULL; elapsed values cannot become negative.

The calculation is request-wide: while any approver holds a request, that overlap
is paused for all request-based duration statistics, including a parallel
approver's waiting window. Approval activation times still define the start for
maintenance waiting ages; absent historical activation remains unknown.

## Manual deployment

**MANUAL DATABASE MIGRATION REQUIRED**:
`purchase-backend/sql/manual/048_approval_hold_adjusted_timing.sql`.

1. Apply SQL 048 in the Supabase SQL Editor before deploying this backend. It
   requires PostgreSQL 14+ and the existing approvals/approval_logs schema. It
   creates an indexed history lookup and a stable invoker-rights SQL function.
   Reapplying it preserves approval and request data; no backfill is required.
2. Deploy the backend, then rebuild/publish the frontend and refresh dashboards.
3. Verify a request with known hold/resume events against calendar duration minus
   their union. Verify that request counts and cost totals remain the same.

The function has no PUBLIC execute grant and does not bypass RLS. Standard
owner/backend connections can execute it; a custom backend role needs an explicit
EXECUTE grant on `public.approval_active_elapsed_seconds(bigint,timestamptz,timestamptz)`
plus its existing authorized table access. Do not grant browser roles access.

New hold/resume actions continue using the existing transactional approval history
writer. No production database is contacted by this change's tests. The disposable
PostgreSQL suite applies SQL 048 twice and executes actual dashboard queries for
90-day, repeated, parallel, open, clipped, missing and terminal hold cases.
