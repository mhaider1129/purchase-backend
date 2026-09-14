# Golden Transaction relationship contract

The Golden Transaction is one evidence chain, not a collection of screen links.
Every transition must either be backed by a foreign key in the canonical domain
tables or by a `document_flow_links` row written in the same transaction as the
target document.

## Connected write path

The canonical writers now persist these document-flow edges atomically:

1. `PURCHASE_REQUEST → PROCUREMENT_AWARD`
2. `PROCUREMENT_AWARD → PURCHASE_ORDER` (one edge per PO award)
3. `PURCHASE_ORDER → BUDGET_COMMITMENT` when the approved PO is issued
4. `PURCHASE_ORDER → GOODS_RECEIPT`
5. `GOODS_RECEIPT → INVENTORY_MOVEMENT` for each accepted inventory posting
6. `PURCHASE_ORDER → AP_INVOICE`
7. `AP_INVOICE → THREE_WAY_MATCH`
8. `AP_INVOICE → AP_VOUCHER`
9. `AP_VOUCHER → FINANCE_POSTING → ACCOUNTS_PAYABLE`
10. `ACCOUNTS_PAYABLE → PAYMENT`

These edges supplement, rather than replace, the operational foreign keys. A
retry returns the already-created document before reaching the edge writer, so
idempotent commands do not append duplicate evidence.

## Existing relational branches

The receipt-to-asset branch is carried by the procurement provenance foreign
keys on `assets` (`goods_receipt_id` and `goods_receipt_item_id`). Equipment has
a one-to-one `asset_id`; RFID tags have `asset_id`; contract coverage has
`equipment_id`; maintenance work orders have both `equipment_id` and optional
`coverage_id`; and work-order parts carry governed spare-part and stock-item
identities. Those relationships must remain IDs selected from upstream records,
never re-keyed descriptions entered on another page.

Demand-to-request is carried by `procurement_plan_item_requests`, which binds a
plan item to both request and requested-item IDs. Approval evidence remains in
the approval route/history tables. Sourcing evidence remains in award
`source_type/source_id` and PO-line price provenance. Financial close remains a
derived outcome and must not be emitted merely because a payment exists: all
payables, unresolved invoices, and active encumbrances must first be cleared.