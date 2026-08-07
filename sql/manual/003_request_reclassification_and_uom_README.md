# Manual migration 003

This migration adds only approval supersession and route-snapshot support. The existing requested-item schema already has `request_mode`, `catalog_status`, `restriction_justification`, and pending-item support; UOM conversion is application-only.

1. Take a database backup and test restoration.
2. Review the guarded preflight check. Duplicate **versioned** route steps still require manual review. Duplicate legacy levels may remain unversioned and do not require deletion.
3. Run the file manually in Supabase SQL Editor during a quiet window. The agent must not run it.
4. Run the trailing read-only validation queries and retain their output.
5. Deploy compatible application code only after the schema succeeds.

Rollback can drop the indexes and new columns only before the application writes supersession history. After that point, column removal destroys audit evidence and is not a safe rollback; roll the application forward instead.

The migration adds the missing supersession fields, `approval_route_version`, its user foreign key, and the route-step/current-active indexes used by the application. `requests.approval_route_snapshot`, `requests.approval_route_snapshot_id`, and `approvals.route_snapshot_id` already appear in the inspected schema; `ADD COLUMN IF NOT EXISTS` is retained for the latter so older environments remain compatible. SQL 002 concerns such as notification outbox and approval timestamps are intentionally not duplicated. No UOM DDL is needed because the current UOM correction is application-only.

`approval_route_version` intentionally remains nullable and has no default. Existing approvals are legacy history, and assigning all of them version `1` can violate route-level uniqueness when an old request has parallel or duplicated levels. The canonical reclassification service always supplies a version for new route steps; older insert paths that do not yet supply one remain unversioned until their Phase 3 consolidation.

Before creating the partial unique index, the migration repairs legacy requests that have multiple active, non-superseded Pending approvals. It deterministically retains one actionable row (newest explicit route version, then lowest approval level and id) and sets only the extra rows' `is_active` flag to `FALSE`. It does not delete, approve, reject, or supersede those rows, so they remain available to history and audit views.