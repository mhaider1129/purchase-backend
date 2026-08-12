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