# SQL 005 — inventory operations

This is a **manual-only** migration. The application never executes it.

1. Schedule an inventory-write maintenance window and stop live inventory writers.
2. Take and verify a restorable backup.
3. Run the preflight queries and stop on negative balances, missing Phase 3A objects, or blank existing coordinator idempotency keys. On a fresh install where a coordinator table does not yet exist, omit its blank-key query until after creation.
4. Review the installed `permissions` schema (the script expects unique `permissions.code`).
5. Run each transaction in `005_inventory_operations.sql` in order; the 3-second lock timeout fails closed. The migration backfills per-allocation transfer receipt progress and legacy reservation metadata without deleting it, and adds a durable reservation-issue operation record before retries can mutate coordinator state.
6. Run post-validation and retain its output with the change record.
7. Deploy application code only after validation; then execute the smoke checklist in the Phase 3B report.

Status transfers do not need another group table: debit and every allocation credit are posted in one shared database transaction, while the required parent key deterministically identifies the debit and each child key. A retry therefore returns the debit and credits already committed; a failed transaction commits none. This also makes a legacy partial group safely resumable because already-posted child keys are returned and missing deterministic children are posted.

The migration never deletes history. Once operational rows exist, rollback is forward-only: disable the new endpoints, correct with a reviewed follow-up migration, and retain ledger, operation, allocation, transfer-link, reservation-allocation, and count records. Expect brief locks on transfer, reservation, allocation, and stock-balance tables while constraints and backfills run.