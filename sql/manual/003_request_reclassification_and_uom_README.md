# Manual migration 003

This migration adds only approval supersession and route-snapshot support. The existing requested-item schema already has `request_mode`, `catalog_status`, `restriction_justification`, and pending-item support; UOM conversion is application-only.

1. Take a database backup and test restoration.
2. Run the validation queries separately before the transaction; resolve duplicate active approvals before creating the unique index.
3. Run the file manually in Supabase SQL Editor during a quiet window. The agent must not run it.
4. Run the trailing read-only validation queries and retain their output.
5. Deploy compatible application code only after the schema succeeds.

Rollback can drop the indexes and new columns only before the application writes supersession history. After that point, column removal destroys audit evidence and is not a safe rollback; roll the application forward instead.