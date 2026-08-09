# Manual SQL 004 runbook

This migration is manual. Application code does not execute it, and no agent connected to Supabase.

## Why the earlier script could deadlock

The earlier version used one transaction for every alteration, backfill, constraint, index, and trigger. Consequently, a lock already obtained on one inventory relation remained held while the migration waited for another. A live inventory request could hold those relations in the opposite order, producing PostgreSQL `40P01`.

The revised file uses independently committed phases, touches one high-write inventory table per DDL phase, requests DDL/index locks with `NOWAIT`, adds foreign keys as `NOT VALID`, and defers constraint validation. A busy database now fails fast rather than waiting in a migration/application lock cycle.

## Recovery after `40P01`

1. Do **not** immediately rerun the old script and do not terminate unidentified sessions.
2. PostgreSQL automatically rolls back the transaction selected as the deadlock victim. Confirm the SQL client shows no open/aborted transaction; reconnect if uncertain.
3. Inspect active inventory writers using the platform's database activity tooling and schedule an inventory-write maintenance window. Do not run diagnostic termination SQL without DBA review.
4. Take and verify a fresh backup of `warehouse_stock_levels` and `inventory_transactions`.
5. Compare the current schema with each phase. All additions use `IF NOT EXISTS` or recreate named constraints safely, so the revised migration is resumable after review.
6. Run Phase 0 alone. Stop if any count is nonzero.
7. Run Phases 1–4 **one phase at a time**, confirming each `COMMIT`. A `55P03 could not obtain lock` result is safe: wait for the maintenance window and retry that phase.
8. Run the two Phase 5 index transactions during the maintenance window. They use ordinary `CREATE INDEX` because the Supabase SQL Editor can wrap submissions in a transaction. A `55P03` means a writer is still active; stop it and retry that phase rather than removing `NOWAIT`.
9. Install Phase 6, then run each Phase 7 validation statement separately. Finish with all post-validation queries.

## Recovery after `25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`

The SQL client wrapped the index statement in a transaction. PostgreSQL did not create that concurrent index. Do not retry the prior `CONCURRENTLY` statements in the same client. Use the revised Phase 5, which deliberately uses ordinary, transaction-compatible index creation under `SHARE MODE NOWAIT`.

Before resuming, verify Phases 1–4 from the schema or rerun them individually—their DDL is resumable. Then run the revised Phase 5 during the maintenance window. If its uniqueness pre-flight returns rows, stop and reconcile those records instead of creating the corresponding unique index. Its catalog pre-flight must also return no invalid same-named indexes; if it reports one, have a DBA drop only that invalid index before retrying. Continue with Phases 6–7 only after both Phase 5 transactions commit.

## Prerequisites

- Rehearse against a current staging clone and verify restore from backup.
- Stop API workers, scheduled inventory jobs, receipt processing, issue/transfer operations, and other direct legacy writers for Phases 1–6. Ordinary index builds intentionally block writes and may take time on large tables.
- Confirm the `institutes` table and referenced IDs match the schema snapshot.
- Run one numbered phase at a time. The file no longer uses `CREATE INDEX CONCURRENTLY`, so Phase 5 is compatible with clients that wrap submitted SQL in a transaction.
- Ensure retrying APIs supply stable idempotency keys before enabling the engine.

## Integrity preflights and application contract

Run the Phase 5 balance and serial preflights after Phase 1 has added the identity columns and before either balance index is built. Every query must return zero rows. Duplicate canonical balances are never auto-merged: stop and obtain inventory-owner/DBA review. The canonical balance identity exactly matches application inbound lookup: `warehouse_id`, `stock_item_id` (called `inventoryItemId` internally), `stock_status`, `batch_number`, `lot_number`, `serial_number`, and `expiry_date`, with nulls equal. Outbound allocation may span unspecified identities and locks rows in FEFO order (`expiry_date ASC NULLS LAST`, then `id`).

Available positive serial uniqueness is scoped to `(stock_item_id, serial_number)`, so one item/serial cannot be available in two warehouses while different items may share serial text. PostgreSQL 15 or newer is required for the `NULLS NOT DISTINCT` canonical identity index.

Phase 3A generic posting explicitly rejects quarantine/release because atomic status transfer is deferred, and rejects dispatch/receipt because a transfer coordinator does not yet own the complete destination lifecycle. Thus no successful status ledger entry can be written without a projection change, and transfer types in the ledger constraint are reserved for the future internal coordinator.

## Rollback limitations

Schema additions can remain safely in place. Once new engine movements exist, never remove ledger data or its source/reversal fields. Restore application compatibility first and preserve posted rows. Removing constraints or indexes weakens guarantees. Disable the immutable trigger only as part of a reviewed recovery, then restore it immediately.