# Phase 4 connected procure-to-pay report

## Architecture findings and new flow
The prior application had usable request assignment, RFx/evaluation, contracts, budget, PO/receipt/invoice/payment documents, canonical inventory, audit, and outbox foundations, but controllers connected them through mutable request cost/name/status fields and independent calculations. The authoritative flow is now defined as: approved request/assignment → sourcing → durable split award → provenance-backed PO → atomic release/commitment → typed receipt → canonical inventory when applicable → supplier invoice → exact structured two/three-way match → AP approval → idempotent partial/final payment → derived closure.

## Authority map
* `suppliers.id` is identity. Eligibility uses only existing active/status, qualification, compliance, suspension and supplied category/contract relationships; absent metadata is documented rather than assumed. Eligibility is checked at award and release, without retroactively invalidating issued POs.
* `procurement_awards` records who/what/quantity/price/source/reason/actor/time and supports split awards under a locked request-item ceiling.
* Pricing selects effective contract line, awarded quotation/framework, approved direct purchase, then permission-gated manual exception. PO lines freeze source type/ID. Historical FX is stored, never refreshed.
* PO service validates award/request traceability and pricing, invokes one BigInt fixed-scale totals engine (four-place inputs, half-up to two currency decimals), commits budget, transitions, audits and enqueues within one transaction.
* Existing budget envelopes are reused. Request estimate is informational; released PO is formal commitment; invoice/accounting is actualization; payment is settlement. Unused commitment is released, not expensed.
* Existing goods receipt inventory adapter/canonical inventory engine remains stock authority. Locked cumulative receipt lines and unique keys prevent over-receipt/retry duplication. Service/non-inventory lines never post stock.
* Supplier invoice identity is `(supplier_id, normalized invoice_number)`. Existence does not make it payable. Two-way matching is PO/invoice; inventory uses receipt-backed three-way matching. No tolerance configuration was found, so matching is exact and variances are structured.
* Payments lock and re-sum approved payable balance, support partial settlement, use idempotency, and require compensating reversals rather than deletion.
* Completion separately derives procurement, receipt and financial completion. Fully received but unpaid is receipt-complete and financially incomplete. Split-line completion aggregates all authoritative PO lines.
* Cancellation checks downstream receipts/payments. Unreceived PO cancellation releases commitment; received stock requires return/reversal; paid invoice requires financial reversal/credit.

## Authorization, audit and notification
Existing permission middleware/capabilities must be mapped to sourcing, award, PO release, receipt, match, invoice/payment approval and budget authority; role names are not new authority. Repository predicates enforce institute/department scope. Shared audit records award, override, PO, commitment, receipt, invoice/match, payment and reversal events. Existing historical audit remains. Existing transactional outbox is reused, and external delivery never controls transaction success.

## SQL 006 and rollout
SQL 006 adds only awards, PO traceability/provenance/currency, formal budget commitments, invoice/receipt/payment identity and idempotency details. It does not duplicate suppliers, contracts, budget envelopes, P2P documents, inventory or outbox. See its README for backup, preflight, locks, ordering, validation and rollback limits.

## Remaining risks/deferred work
* Manually reconcile legacy rows lacking supplier IDs and duplicate supplier invoice numbers before constraints.
* Cut each legacy mutation route over only after SQL deployment; compatibility projection writers remain a controlled transition risk.
* Confirm production table/FK names and numeric scale from live DBA metadata without connecting this work session.
* Define governed FX source, tolerance configuration, over-delivery policy, credit notes, payment batches/multi-invoice allocation, contract consumption limits and asset capitalization later.
* Map exact existing permission identifiers and add scoped integration/concurrency tests against an isolated PostgreSQL database.

## Recommended Phase 5
Operationalize AP/accounting: governed exception/tolerance approval, credit/debit notes and reversals, contract consumption, FX governance, bank/payment reconciliation, tax reporting, outbox operations, projection rebuild jobs, and observability/SLA dashboards—without changing the Phase 3 inventory ledger.

No SQL was executed against Supabase.