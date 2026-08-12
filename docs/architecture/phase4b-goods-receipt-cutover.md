# Phase 4B goods-receipt cutover

## Audit completed before implementation

The former live `POST /procure-to-pay/requests/:requestId/receipts` sequence was one controller transaction: ensure tables/lifecycle; lock the request and optionally the PO; accept `PO_APPROVED`; call `procureToPayPersistenceService` to insert `goods_receipts` and `goods_receipt_items`; increment PO-line `received_quantity` by requested-item/name matching; resolve stock by generic item/requested item/name; invoke the Phase 3 adapter; create a receipt-stage finance commitment; derive and write PO status; transition lifecycle; and directly insert finance/audit history. Email was sent after commit. This combined legacy identity fallback, receipt history, projections, inventory, finance, lifecycle, and notification in one controller.

## Write inventory and classification

| State written by receipt path | Former writer | Classification after cutover |
|---|---|---|
| `goods_receipts` / `goods_receipt_items` | persistence service called by controller | **TO-DISABLE** for PO receipts; **CANONICAL** repository methods now used by `goodsReceiptService` |
| `purchase_order_items.received_quantity` | controller additive update | **DUPLICATE / TO-DISABLE**; repository history-derived update is **PROJECTION** |
| `purchase_orders.status` | controller | **TO-MIGRATE**; repository status methods coordinated by service are **CANONICAL** |
| `requested_items.received_quantity`, `requested_items.is_received` | no write in audited controller | **LEGACY** elsewhere; not receipt authority |
| `warehouse_stock_levels`, `inventory_transactions` | Phase 3 adapter/posting service | **CANONICAL** inventory writer |
| `warehouse_stock_movements` | explicitly skipped by old controller | **LEGACY / TO-DISABLE** |
| lifecycle state/history | controller transition | **TO-DISABLE** on canonical receipt path; PO status and transactional receipt events are authoritative pending lifecycle projection consolidation |
| `finance_action_history`, `audit_logs` | controller helper | finance history **TO-DISABLE** for Phase 4B receipts; shared audit service **CANONICAL** |
| notification outbox | not used by old receipt path | **CANONICAL** transactional notification writer |

Read-only receipt list/detail/dashboard/invoice-match queries remain projections/consumers, not writers. Non-PO receipt behavior is intentionally not silently routed through the PO coordinator and is deferred rather than treated as an alternate PO receipt authority.

## Canonical transaction and API

`createGoodsReceipt({ repository, purchaseOrderId, idempotencyKey, lines, receivedAt, actor, auditService, outbox, ...context })` owns `repository.withTransaction`. It checks idempotency before locks, locks the PO, admits only `PO_ISSUED` and the catalog's existing `PO_PARTIAL`, locks unique PO-line IDs in ascending order, validates every line, calculates remaining from cumulative receipt rows, writes header/lines, repairs projections, posts only `INVENTORY` lines through the Phase 3 adapter using the same client, derives PO status, audits, and enqueues deterministic outbox events. Any error rolls the entire operation back.

The client supplies `Idempotency-Key` (also accepted as body `idempotency_key`). A SHA-256 fingerprint covers PO identity and sorted line identities, gross/damaged/short quantities, tracking, warehouse, and stock status. Identical retries return the stored header and lines before any side effect; changed reuse returns `IDEMPOTENCY_CONFLICT`.

Gross `goods_receipt_items.received_quantity` is authoritative history. Accepted quantity is gross minus damaged minus short. Both the PO-line projection and completion totals use accepted quantity; over-receipt protection uses gross cumulative receipt history, preventing discrepancies from being used to receive the same ordered units repeatedly. Decimal values are compared at four-decimal fixed scale.

`INVENTORY` lines require a canonical stock-item mapping and a scoped warehouse and post through `goodsReceiptInventoryAdapter -> inventoryPostingService`. `NON_INVENTORY`, `SERVICE`, `ASSET`, and `MEDICAL_DEVICE` remain receipt-only in this cutover; no stock is inferred from a warehouse ID. Tracking columns preserve batch, lot, serial, expiry, warehouse, stock status, and UOM. `QUARANTINE` is posted directly as quarantined stock, never as available.

The existing status catalog calls partial receipt `PO_PARTIAL` (not `PO_PARTIALLY_RECEIVED`). All required PO lines must be complete before `PO_DELIVERED` is written.

## Cancellation and remaining work

No live receipt deletion/cancellation endpoint was found. Phase 4B adds none. Posted inventory receipts must eventually use Phase 3 reversal/return behavior; controlled reversal is deferred to Phase 4B.1. Non-PO receipts, service acceptance workflow, explicit asset/device handoff, completion lifecycle projection, and the legacy lifecycle quick-receipt UI need separate reviewed cutovers. Invoices, AP, matching, payments, and requested-item financial projections were not redesigned.