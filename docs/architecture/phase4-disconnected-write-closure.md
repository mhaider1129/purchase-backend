# Phase 4 cutover batch A: PO issue and commitment closure

## Live controllers and status mapping

The live `procureToPayController` PO endpoints now authorize, parse the PO identifier, call `purchaseOrderService`, shape the response, and forward errors. Submit is strictly `PO_DRAFT` → `PO_PENDING_APPROVAL`; approve is strictly `PO_PENDING_APPROVAL` → `PO_APPROVED` and records `approved_by`/`approved_at`; issue is strictly an actually approved `PO_APPROVED` → `PO_ISSUED`. Cancellation persists `PO_CANCELLED`. No `APPROVED` or `RELEASED` PO status is written.

## Canonical issue transaction

`releasePurchaseOrder({ repository, purchaseOrderId, actor, auditService, outbox })` owns the repository transaction. It locks and loads authoritative PO state, loads lines and supplier, requires completed approval, validates award/requested-item/price provenance, calculates exact decimal totals, derives the fiscal-year budget envelope from the request department/project and PO currency, locks it, and computes availability as `allocated_amount - consumed_amount - active encumbrances`. It inserts the `stage='encumbrance'`, `state='ACTIVE'` commitment with `po-release:{purchaseOrderId}`, marks the PO `PO_ISSUED`, audits `BUDGET_COMMITTED` and `PO_ISSUED`, and enqueues both outbox events before commit. Audit or outbox failure rolls the whole unit back. SMTP is outside and is not a prerequisite.

An issued retry returns the current PO plus the existing commitment. The unique idempotency key and the locked PO/budget rows prevent duplicate financial effect and serialize competing POs against one envelope.

## Cancellation

The cancellation service locks the PO, safely returns an already-cancelled PO, and rejects any positive receipt history with `RECEIPT_RETURN_OR_REVERSAL_REQUIRED`. Otherwise it marks the PO `PO_CANCELLED`, changes its active encumbrance to `RELEASED` without deleting history, audits, enqueues `BUDGET_COMMITMENT_RELEASED` and `PO_CANCELLED`, and commits atomically.

## Repository and writer classification

The connected repository is the canonical writer for Batch A: submission, approval, issue, cancellation, encumbrance insertion, and commitment release. Its methods are entity-specific and its transactional wrapper owns `BEGIN`/`COMMIT`/`ROLLBACK`.

The remaining direct `UPDATE purchase_orders` occurrences are outside this bounded cutover: the receipt compatibility projection in `procureToPayController` and the PO close endpoint. The remaining direct `INSERT INTO commitment_ledger` in `financeCoreService` supports the pre-existing reservation/actual finance flow, not PO-issue encumbrance. There are no other direct `UPDATE commitment_ledger` writers. Receipt, invoice, matching, payment, and requested-item projection paths remain intentionally unchanged.

## SQL 006

No SQL 006 change is required. It already adds `purchase_order_id`, `idempotency_key`, and `state`; retains existing `stage` and `actor_id`; constrains commitment state; and provides unique idempotency and one-active-PO-encumbrance indexes. The checked-in schema snapshot has no PO status CHECK constraint. If a deployed database has an out-of-snapshot PO status CHECK, the required DBA-reviewed migration is to replace that constraint so it permits exactly `PO_DRAFT`, `PO_PENDING_APPROVAL`, `PO_APPROVED`, `PO_ISSUED`, and `PO_CANCELLED` before cutover. SQL 006 remains manual and was not executed.

## Behavioral coverage

Executable service tests cover submit/invalid submit, approve, issue, one commitment, issue retry, exact 100/70 budget success, serialized second-70 failure, rollback on budget/audit/outbox failure, unreceived cancellation/release, received cancellation rejection, retry safety, canonical events, and canonical statuses. Controller tests exercise real controller authorization and service delegation rather than relying only on source-string assertions.

No SQL was executed against Supabase.
## Phase 4B receipt closure

The live PO receipt route now delegates to `goodsReceiptService`; it contains no receipt, PO projection/status, or warehouse SQL. The service calls only entity-specific methods on `connectedP2PRepository`, and only `goodsReceiptInventoryAdapter` reaches the Phase 3 inventory writer.

* `connectedP2PRepository`: **CANONICAL REPOSITORY** for `goods_receipts`, `goods_receipt_items`, PO-line receipt projection, and PO receipt status.
* `procureToPayPersistenceService.insertGoodsReceipt`: **LEGACY ACTIVE only for callers not yet cut over / TO-DISABLE**; it is no longer reachable from the live PO receipt controller.
* `ensureProcureToPayTables`: **SCHEMA FOUNDATION**, not a business writer.
* Tests/fixtures containing receipt SQL: **TEST**.
* Receipt list/dashboard/matching SQL: **READ PROJECTION**.
* `requested_items` receipt flags outside this route: **LEGACY**, never canonical PO receipt history.

No active live PO receipt path directly updates warehouse balances or `warehouse_stock_movements`.
## Phase 4C invoice/match closure (2026-08-12)

The request-scoped invoice submission, matching, approval, and decline endpoints now delegate to `supplierInvoiceService`. Runtime invoice header/line/result SQL is confined to `connectedP2PRepository`. `procureToPayPersistenceService.insertSupplierInvoice` remains classified **LEGACY / TO_DISABLE** for compatibility but has no live controller caller. Override evidence is append-only; request lifecycle, finance ledger, payable, and payment writers are projections or later-phase authorities.
## Phase 4D finance closure addendum

Canonical repository writes now cover finance-eligible invoice selection, voucher/payable creation, payment records, allocations, payable synchronization, invoice payment projection, and document links. Controller payment and voucher writes were cut over. `markPaid` is disabled.

Remaining **LEGACY ACTIVE** writers are `postPayableFromInvoice`, `postToInternalLedger`, and the zero-value `markPaymentPending` scheduler. Existing migration/ensure-table DDL is **HISTORICAL/IMPORT**, test fixtures are **TEST**, lifecycle and invoice paid states are **COMPATIBILITY PROJECTION**, and `connectedP2PRepository` is the **CANONICAL REPOSITORY**. Production rollout is blocked until legacy posting/payable routes and the frontend quick action are removed or delegated to the atomic AP posting workflow.
# Phase 4D final direct-write closure

The live `postToInternalLedger` controller delegates to `apPostingService`; it no
longer inserts finance postings or accepts a caller-selected liability. Voucher
verification delegates to `accountsPayableService`, and payable payments delegate
to `paymentService`. The legacy direct invoice-to-payable and payment-pending
controllers are disabled with HTTP 410.

Production financial SQL is intentionally confined to repository gateways and
the pre-existing `financeCoreService` PO-encumbrance writer. In
`connectedP2PRepository`, AP posting owns finance posting, actual evidence,
remaining encumbrance, consumed projection, and payable activation; payment owns
the payment header/allocation and balance projection. Read-only reporting queries
in controllers remain non-authoritative. Lifecycle projection writes remain in
the lifecycle service/repository boundaries and are not accounting evidence.