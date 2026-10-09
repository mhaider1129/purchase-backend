# Maintenance approval waiting times

The Maintenance Request Status page reports current active Pending approvals.
Approval cards count distinct requests per level/role and show the oldest known
wait, overdue request count and requests with unknown waiting times. Parallel
approvals may put one request in several cards; the all-pending card counts it once.

Date, search, reference and requester filters constrain every card. Status cards
remain facets before the selected status; approval cards remain facets before the
selected approval step/waiting-time filter, so other choices stay available.
The queue and Excel export apply all selected filters. Selecting a particular
step scopes waiting times and current owners to that step.

Set an overdue target from 1 to 365 whole days in the view. A recorded wait must
strictly exceed that target to be overdue. This setting lasts for the mounted
page only; it does not change workflow rules, deadlines, permissions or reminders.
No overdue classification is made until a target is set. Unknown waiting times
can be filtered separately and sort after known times in oldest-first order.

## Deployment

MANUAL DATABASE MIGRATION REQUIRED:
`purchase-backend/sql/manual/045_approval_activation_timestamps.sql`

1. Apply the complete SQL manually in Supabase SQL Editor, including verification.
2. Deploy the backend read API change and rebuild/deploy the frontend.
3. Set the reporting target and select the overdue or unknown-time filter.

The patch adds `approvals.activated_at` and a trigger. It records future active
Pending insertions, activations and ownership/level changes, preserving all
existing business rows. Ordinary comments, retries and decisions retain the
recorded start. Reactivating a decided/inactive/superseded task begins a new wait.
There is no backfill: creation time and updated_at cannot establish when an
existing approval became actionable. Existing active approvals remain unknown
until a genuine activation/ownership change occurs; do not toggle approvals just
to create timestamps.

The read API uses a JSON field lookup and remains compatible before applying the
patch, returning unknown timestamps instead of failing on a missing column.
Waiting ages refresh every minute; ownership data reflects the fetched page data
and updates on reload. This release does not add automatic reminders or escalation.

## Validation

Frontend tests cover boundaries, targets, unknown/future timestamps, parallel
steps, oldest-first sorting, filtered counts and matching Excel columns. Backend
tests preserve viewer authorization. Disposable PostgreSQL validation executes
the real query before the migration and verifies the patch's historical-data
preservation, activation, ownership changes, edits, decisions and repeatability.
No SQL is executed against Supabase by these checks.
