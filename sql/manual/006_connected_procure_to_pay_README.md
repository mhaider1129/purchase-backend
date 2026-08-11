# SQL 006 — Connected Procure-to-Pay

This is an **additive, manual migration**. It was authored against the repository schema snapshot; it has not been executed. It reuses `suppliers`, purchase request/item, PO, receipt, invoice, payment, budget envelope, and notification-outbox structures.

## Before the maintenance window
1. Take and verify a restorable full database backup; retain a schema-only dump.
2. Run the commented preflight queries separately. Resolve duplicate invoice identities and missing PO supplier identities; do not delete history.
3. Review table/FK names against the target environment and estimate rewrite/lock duration from relation sizes.
4. Stop P2P writers. Keep readers available only if their transaction duration is bounded.

## Migration order
1. Awards and their indexes.
2. Supplier/currency and award traceability on PO headers/lines.
3. Commitments.
4. Invoice identity, line traceability, and match details.
5. Payment and receipt idempotency/traceability.
6. Run the post-validation queries and application tests, then restore writers.

`lock_timeout` fails rather than waiting indefinitely. `CREATE INDEX` inside this transaction is not concurrent; for large production tables, a DBA may split indexes into separately reviewed `CREATE INDEX CONCURRENTLY` statements. Existing nullable columns deliberately permit staged backfill. Add `NOT NULL` only in a later migration after validation.

## Rollback limitations
DDL can roll back before commit. After application writes use these structures, dropping them destroys sourcing, commitment, and idempotency history. Roll forward or disable Phase 4 routes instead. Historical `supplier_name`, request cost, and status projections remain compatibility fields and are not removed.