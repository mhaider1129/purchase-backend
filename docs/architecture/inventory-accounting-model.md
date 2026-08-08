# Inventory accounting model

## Decisions
`inventory_transactions` is the canonical immutable ledger because it already links warehouse, department, item, batch, request, transfer, actor, and normalized item identity. `warehouse_stock_levels` remains the canonical warehouse projection; `stock_items.available_quantity` is only a compatibility cache recalculated from that projection. No new ledger or balance table is introduced.

The movement grain is **institute + warehouse + stock item + batch/lot (optional) + serial (optional) + stock status**. Generic/product/catalog identities remain derivable from `stock_items`; legacy snapshot columns remain for history. Quantity is signed in the ledger and nonnegative in projections. The inventory item's configured UOM is canonical; source quantity/UOM and conversion factor are retained.

## Invariants
1. Posted movements are immutable and never deleted. Corrections are linked compensating movements.
2. A globally unique idempotency key identifies a business posting. Identical retry returns the first posting; conflicting reuse is HTTP 409.
3. On-hand is `warehouse_stock_levels.quantity`. Phase 3 adds only `reserved_quantity`; available is `quantity - reserved_quantity` for `AVAILABLE` rows. Quarantine and blocked statuses remain physical on-hand but are excluded from issue.
4. Negative quantity/reservation is prohibited by locked service checks and database CHECK constraints.
5. Warehouse scope includes institute. Permission policy checks active actor, institute, warehouse, and explicit cross-scope permissions.
6. Posting locks balance rows with `FOR UPDATE`; batch commands sort warehouse, item, tracking identity before acquiring locks. This makes concurrent 7/6 issues from 10 serialize: one succeeds and the other receives `INSUFFICIENT_STOCK`.
7. Tracking policy is item-dependent: none, batch, serial, or batch+expiry. Existing fields do not yet expose a reliable required-tracking policy, so Phase 3 preserves supplied identity without forcing it. Serial uniqueness is database-enforced for available stock. Automated FEFO is deferred to 3B; explicit dimensions are honored and unspecified outbound rows lock in expiry/id order.
8. Transfer dispatch removes source stock and receipt adds destination stock. They are correlated, independently idempotent lifecycle events; dispatch never adds destination stock.
9. Valuation remains separate. Unit cost history may coexist but is not used to calculate quantity.
10. Receipt lines post once, preserve accepted/partial quantity and tracking identity, and quarantine rejected-controlled stock rather than making it issuable.
11. Every movement links source document type/id/line, actor, posted timestamp, correlation, and audit event. Audit failure rolls back the transaction.

## Reversal
The reversal service locks the original, rejects a second reversal, derives the inverse type, posts through the same engine, and links both rows. Receipt reversal can fail if downstream issues leave insufficient stock. Reversal requires reason and its own stable idempotency key.