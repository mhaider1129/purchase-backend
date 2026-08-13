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

## Final canonical-writer closure (2026-08-13)

### RFx production path

`POST /rfx-portal/:id/award`, called by `RfxPortalPage` through `api/rfxPortal`, is the only RFx award/PO path. It selects the explicitly chosen response, locks the event, response, request, and approved request items, and rejects cancelled events, unlinked requests, missing items, invalid quotation totals, and a different pre-existing PO. The response supplier is revalidated by the canonical supplier-eligibility policy. Each approved request item becomes an idempotent `source_type='QUOTATION'` award whose `source_id` is the winning response; the quotation total is apportioned as one unit rate over the approved quantities. The same database transaction records the winning/closed response states, creates awards, creates a provenance-backed `PO_DRAFT`, and updates the RFx/request compatibility projections. A retry returns the PO created from the same response; a conflicting response is rejected.

The RFx endpoint no longer issues a PO, approves it, or commits budget. Its result must follow the ordinary submit → approve → issue endpoints. Only issue creates the PO encumbrance, so RFx cannot bypass approval or budget control; once issued, the PO is an ordinary connected PO eligible for receipt, invoice, AP, payment, and close.

### Commitment classification

The removed `financeCoreService.recordCommitment` had one production caller: request creation. That caller wrote `stage='reservation'`, `source_type='purchase_request'`, for the request estimate. It was neither a PO encumbrance nor AP actualization, but the availability model did not consistently subtract it and there was no conversion/release operation. Retaining it would leave ambiguous, potentially double-counted financial state. Request creation now performs a read-only budget advisory check; the estimate is not financial evidence. PO encumbrance and AP actualization remain exclusively in `budgetCommitmentService`/`apPostingService` through `connectedP2PRepository`. `financeCoreService` retains budget reads and journal/accrual helpers, but no commitment-ledger writer.

### Reachability and repository-wide writer audit

* `procureToPayPersistenceService.insertGoodsReceipt` and `.insertSupplierInvoice`: **LEGACY_TO_REMOVE / TESTED COMPATIBILITY STUBS**. Repository-wide import search finds only their test; both now return HTTP 410 without querying. Live routes use `goodsReceiptService` and `supplierInvoiceService`.
* `requestWorkspaceController`, `contractsController`, and `procureToPayController`: **NO DIRECT PO BUSINESS WRITER**. The live PO endpoints delegate to `purchaseOrderService`; other occurrences are reads/projections.
* `budgetControlController`: **READ PROJECTION**. `financeCoreService`: **NO COMMITMENT WRITER**. P2P encumbrance, release, and actualization SQL exists only in the connected repository.
* Receipt/invoice searches find no production mutation outside `connectedP2PRepository`; the legacy persistence module contains no SQL.
* AP voucher, payable, finance posting, payment, and allocation searches find no production mutation outside `connectedP2PRepository`.

`tests/phase4CanonicalWriterBoundary.test.js` recursively scans production JavaScript and permits mutations of the governed P2P tables only in the single explicitly named connected repository. This is intentionally not a directory-wide service whitelist.

### Final authority table

| Business fact | Canonical writer | Allowed projection writers |
|---|---|---|
| Procurement Award | `procurementAwardService` → `connectedP2PRepository` | RFx/request selected-supplier fields |
| Purchase Order / PO Close | `purchaseOrderService` → `connectedP2PRepository` | request PO reference fields |
| PO Encumbrance (`encumbrance`, `purchase_order`) | `budgetCommitmentService` → `connectedP2PRepository` | `budget_envelopes.consumed_amount` repair only |
| Goods Receipt | `goodsReceiptService` → `connectedP2PRepository` | PO received quantity/status |
| Inventory Movement | `goodsReceiptInventoryAdapter` → Phase 3 inventory authority | stock balance/read models |
| Supplier Invoice | `supplierInvoiceService` → `connectedP2PRepository` | invoice lifecycle status |
| Invoice Match | `supplierInvoiceService` → `connectedP2PRepository` | request lifecycle/read models |
| AP Voucher | `accountsPayableService` → `connectedP2PRepository` | verification status |
| Actualization (`actual`, `ap_voucher`) | `apPostingService` → `connectedP2PRepository` | budget consumed projection |
| Payable | `apPostingService` → `connectedP2PRepository` | payable balance/status |
| Payment | `paymentService` → `connectedP2PRepository` | invoice/payment status |

No active duplicate P2P writer remains. Phase 4 canonical-writer closure is complete at repository level. SQL 006 may now proceed to manual DBA-reviewed execution after the already documented backup, reconciliation, preflight, and live-schema checks; application rollout must remain ordered after it.

No SQL was executed against Supabase.
## Phase 4B receipt closure

The live PO receipt route now delegates to `goodsReceiptService`; it contains no receipt, PO projection/status, or warehouse SQL. The service calls only entity-specific methods on `connectedP2PRepository`, and only `goodsReceiptInventoryAdapter` reaches the Phase 3 inventory writer.

* `connectedP2PRepository`: **CANONICAL REPOSITORY** for `goods_receipts`, `goods_receipt_items`, PO-line receipt projection, and PO receipt status.
* Historical classification (superseded by the final closure above): `procureToPayPersistenceService.insertGoodsReceipt` was legacy/to-disable and is now a fail-closed stub.
* `ensureProcureToPayTables`: **SCHEMA FOUNDATION**, not a business writer.
* Tests/fixtures containing receipt SQL: **TEST**.
* Receipt list/dashboard/matching SQL: **READ PROJECTION**.
* `requested_items` receipt flags outside this route: **LEGACY**, never canonical PO receipt history.

No active live PO receipt path directly updates warehouse balances or `warehouse_stock_movements`.
## Phase 4C invoice/match closure (2026-08-12)

The request-scoped invoice submission, matching, approval, and decline endpoints now delegate to `supplierInvoiceService`. Runtime invoice header/line/result SQL is confined to `connectedP2PRepository`. The former legacy invoice writer is now a fail-closed compatibility stub. Override evidence is append-only; request lifecycle, finance ledger, payable, and payment writers are projections or later-phase authorities.
## Phase 4D finance closure addendum

Canonical repository writes now cover finance-eligible invoice selection, voucher/payable creation, payment records, allocations, payable synchronization, invoice payment projection, and document links. Controller payment and voucher writes were cut over. `markPaid` is disabled.

Historical note: `postPayableFromInvoice`, `postToInternalLedger`, and `markPaymentPending` were subsequently disabled or delegated. Existing migration/ensure-table DDL is **HISTORICAL/IMPORT**, test fixtures are **TEST**, lifecycle and invoice paid states are **COMPATIBILITY PROJECTION**, and `connectedP2PRepository` is the **CANONICAL REPOSITORY**.
# Phase 4D final direct-write closure

The live `postToInternalLedger` controller delegates to `apPostingService`; it no
longer inserts finance postings or accepts a caller-selected liability. Voucher
verification delegates to `accountsPayableService`, and payable payments delegate
to `paymentService`. The legacy direct invoice-to-payable and payment-pending
controllers are disabled with HTTP 410.

Production financial SQL is intentionally confined to repository gateways. In
`connectedP2PRepository`, AP posting owns finance posting, actual evidence,
remaining encumbrance, consumed projection, and payable activation; payment owns
the payment header/allocation and balance projection. Read-only reporting queries
in controllers remain non-authoritative. Lifecycle projection writes remain in
the lifecycle service/repository boundaries and are not accounting evidence.

## Final closure correction (2026-08-13)

The authoritative connected sequence is **Approved Request → Award → PO → Encumbrance → Receipt → Inventory → Invoice → Match → Finance Verification → AP Voucher → AP Posting → Actualization → Payable → Payment → Close**. PO close is no longer a controller-owned transaction: the controller delegates to `purchaseOrderService`, which uses `connectedP2PRepository` for the PO lock, accepted receipt totals, sole active encumbrance lock/release, consumed projection synchronization, and PO close write. Audit and outbox writes remain inside the same transaction. Retrying `PO_CLOSED` produces no second release or event.

The remaining encumbrance is released in place; actualization rows are never released or reversed. Thus a 1,000 commitment with 900 of active actual evidence closes by changing only the remaining 100 encumbrance to `RELEASED`, leaving consumed budget at 900 and restoring 100 of availability. A fully actualized PO has no release effect.

This historical audit found the RFx PO writer, finance commitment writer, and retained persistence SQL that the final closure section above has now removed or delegated.

SQL 006 remains manual-only. Its non-mutating preflight uses catalog checks plus dynamic SQL for self-introduced optional columns, especially `commitment_ledger.ap_voucher_id`, so a pre-006 schema does not bind an absent column. Subject to DBA review, backup, legacy-data reconciliation, and live-schema confirmation, SQL 006 is ready for manual execution; application rollout is still blocked by the writer paths above.

No SQL was executed against Supabase.