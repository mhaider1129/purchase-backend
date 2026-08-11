# SQL 005 — inventory operations

This is a **manual-only** migration. The application never executes it.

1. Schedule an inventory-write maintenance window and stop live inventory writers.
2. Take and verify a restorable backup.
3. Run the preflight query and stop on negative balances or missing Phase 3A objects.
4. Review the installed `permissions` schema (the script expects unique `permissions.code`).
5. Run each transaction in `005_inventory_operations.sql` in order; the 3-second lock timeout fails closed.
6. Run post-validation and retain its output with the change record.
7. Deploy application code only after validation; then execute the smoke checklist in the Phase 3B report.

The migration never deletes history. Once operational rows exist, rollback is forward-only: disable the new endpoints, correct with a reviewed follow-up migration, and retain ledger, allocation, transfer-link, reservation, and count records.