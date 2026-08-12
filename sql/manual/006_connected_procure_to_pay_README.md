# SQL 006 — Connected Procure-to-Pay

This is an **additive, manual migration**. It was authored against the repository schema snapshot; it has not been executed. It reuses `suppliers`, purchase request/item, PO, receipt, invoice, payment, budget envelope, and notification-outbox structures.

## Before the maintenance window
1. Take and verify a restorable full database backup; retain a schema-only dump.
2. Run the documented preflight queries separately. Resolve duplicate invoice identities and dangling non-null references; do not delete history.
3. Review table/FK names against the target environment and estimate rewrite/lock duration from relation sizes.
4. Stop P2P writers. Keep readers available only if their transaction duration is bounded.

### Nullable legacy requested items

The checked-in production schema permits `requested_items.request_id` to be
`NULL`. Such rows are unlinked legacy records, not orphaned foreign-key
references, and SQL 006 does not attach, delete, or guess a request for them.
The preflight emits a notice and connected P2P excludes them until they are
governed and linked. It still aborts if a **non-NULL** `request_id` refers to a
request that does not exist.

DBAs can review both populations without modifying data:

```sql
SELECT count(*) AS unlinked_legacy_items
FROM public.requested_items
WHERE request_id IS NULL;

SELECT ri.id, ri.request_id
FROM public.requested_items ri
LEFT JOIN public.requests r ON r.id = ri.request_id
WHERE ri.request_id IS NOT NULL AND r.id IS NULL;
```

### Nullable legacy purchase-order suppliers

The checked-in schema also permits `purchase_orders.supplier_id` to be `NULL`.
SQL 006 neither adds a `NOT NULL` constraint nor needs to rewrite these legacy
draft/historical records, so their presence produces a notice instead of
aborting the additive migration. This does not make them usable by connected
P2P: canonical PO issue and invoice submission still require a governed supplier
identity. A non-null supplier reference whose parent supplier is missing remains
a blocking preflight error.

DBAs can inspect both cases without changing data:

```sql
SELECT id, request_id, po_number, status
FROM public.purchase_orders
WHERE supplier_id IS NULL;

SELECT po.id, po.supplier_id
FROM public.purchase_orders po
LEFT JOIN public.suppliers s ON s.id = po.supplier_id
WHERE po.supplier_id IS NOT NULL AND s.id IS NULL;
```

### Optional legacy requested-item columns

Different deployed schema generations do not have the same denormalized award
fields on `requested_items`. In particular, `unit_cost` may exist while
`supplier_name` does not. SQL 006 discovers either column through
`information_schema.columns` and inspects only columns that actually exist. A
populated value produces a reconciliation notice; an absent optional column is
not an error and is never referenced by a statically parsed query.

### Existing procurement awards relation

SQL 006 is restart-safe when an earlier reviewed deployment already created
`public.procurement_awards`: both the table and its request-item index use
`IF NOT EXISTS`. Before relying on that behavior, preflight verifies that all 15
columns consumed by the connected P2P application contract are present. An
unrelated or partially created relation with the same name remains a blocking
error instead of being silently accepted or destructively replaced.

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