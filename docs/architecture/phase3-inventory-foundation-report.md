# Phase 3 inventory foundation report

## Delivered architecture
- **Ledger:** existing `inventory_transactions`, extended by manual SQL 004. **Projection:** existing `warehouse_stock_levels`; `stock_items.available_quantity` remains a compatibility cache.
- **Types:** goods receipt/reversal, issue/reversal, transfer dispatch/receipt, positive/negative adjustment, quarantine/release. Definitions centrally encode direction, destination/source/reason requirements, permission, status change, and reversibility.
- **Migrated:** single and multi-line warehouse-to-department issue. The controller validates destination, opens one transaction, and calls one deterministically ordered batch post. No issue line can commit independently.
- **Foundation only:** goods-receipt adapter builds stable per-line idempotency commands, partial accepted quantities, source links, and quarantine status. The legacy receipt write remains deliberately documented until SQL 004 and staging reconciliation are complete.
- **Concurrency:** balance rows are selected `FOR UPDATE`, in warehouse/item/tracking order. Conditional nonnegative updates and CHECK constraints provide defense in depth.
- **Reversal:** locked original plus inverse compensating movement; unique reversal link; reason and idempotency required; originals are not deleted.
- **UOM:** item inventory UOM is base fallback; source quantity/UOM/factor are retained. Existing UOM utilities do not offer general database conversion, so callers must supply a reviewed factor; richer conversion lookup is 3B.
- **Tracking/quarantine:** batch/lot/serial/expiry are preserved. Available serial uniqueness is constrained. Non-available status cannot be issued. Required tracking policy and FEFO allocation remain risks for 3B.
- **Authorization:** existing permission catalog and permission loader are reused, including backward-compatible warehouse/receipt permissions. Actor active, institute, warehouse, and cross-scope permission rules are centralized.
- **Audit:** central `auditService` uses the posting client, so audit failure rolls back balance and ledger.

## SQL and deployment boundary
`sql/manual/004_inventory_transaction_engine.sql` adds compatible columns, constraints, indexes, and immutability enforcement. It must be reviewed and manually run during a maintenance window after backup and staging rehearsal. Application startup does not execute it.

## Tests and verification
Focused tests cover validation, type metadata, receipt command construction, deterministic posting behavior, idempotency/conflict, authorization, negative prevention, rollback boundaries, reversal, and migrated controller behavior. Database concurrency and constraint tests require a PostgreSQL staging clone after SQL 004. Known unrelated baseline failures remain in `tests/app.test.js` and historical expectations in `tests/warehouseInventoryController.test.js`; tests were not weakened.

Post-change writer search:
```sh
rg -n -i "(UPDATE|INSERT INTO)\\s+(warehouse_stock_levels|warehouse_item_batches|department_stock_levels|stock_items)|inventory_transactions|warehouse_stock_movements" purchase-backend --glob '!node_modules/**'
```

## Remaining risks and Phase 3B
1. Migrate procure-to-pay receipt with reconciliation and remove its direct upsert.
2. Replace instant transfer approval with dispatch/in-transit/acceptance lifecycle.
3. Migrate add/discard, warehouse supply, request receipt helper, and initial allocation.
4. Add item-master tracking policy and database-backed conversion graph; implement FEFO reservation/allocation.
5. Model department stock as an engine-managed destination projection (Phase 3 currently records the destination in movement metadata/location).
6. Connect recall/quarantine controls to status movements and availability queries.
7. Add live PostgreSQL race tests and operational idempotency monitoring.

## Manual smoke checklist
- Apply SQL 004 only in a disposable staging clone; run post-validation.
- Give a test actor `inventory.issue` (or legacy warehouse permission), matching institute/warehouse scope.
- Seed 10 AVAILABLE units; submit issue 7 and 6 concurrently and verify one 409 `INSUFFICIENT_STOCK`, final 3 or 4, never negative.
- Retry the successful request with the same idempotency key and identical body; verify one ledger row. Change quantity with the same key; verify 409.
- Submit a two-line issue with one insufficient line; verify no balance, ledger, cache, or audit change.
- Verify QUARANTINE cannot be issued and is excluded from available stock.
- Post a receipt adapter line twice; verify one ledger movement and preserved batch/expiry.
- Reverse an issue with reason; verify compensating row/link and restored balance. Retry safely; attempt another reversal key and verify rejection.
- Verify audit records contain source/correlation/balance context without secrets.
- Re-run the direct-writer search and compare with `inventory-legacy-write-paths.md`.

No SQL was executed against Supabase.