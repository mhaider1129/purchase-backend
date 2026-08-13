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

## Canonical-writer closure declaration (2026-08-13)

The final writer audit is closed. RFx selection now composes canonical award and `PO_DRAFT` creation in its existing governed transaction; it cannot issue, approve, or encumber a PO. The former request-estimate commitment writer was removed because it had no safe conversion/release model, while request budget feedback remains advisory. The unreachable receipt/invoice persistence writers are fail-closed HTTP 410 compatibility exports with no SQL. A production-source architecture test restricts PO, receipt, invoice, match, commitment, AP, posting, payable, and payment mutations to `repositories/connectedP2PRepository.js`.

The authoritative chain and authority table are detailed in `phase4-disconnected-write-closure.md`. No unexplained active duplicate writer remains, so Phase 4 can be declared canonical-writer complete. SQL 006 remains unchanged and unexecuted; it should be manually executed only by the DBA after the documented review gates.

No SQL was executed against Supabase.

## Final Phase 4 closure correction (2026-08-13)

The final authoritative chain is **Approved Request → Award → PO → Encumbrance → Receipt → Inventory → Invoice → Match → Finance Verification → AP Voucher → AP Posting → Actualization → Payable → Payment → Close**.

PO close now belongs to `purchaseOrderService` and the connected repository transaction. It locks the PO, derives full delivery from ordered/accepted receipt facts, requires a governed reason for an early close, locks and releases only the remaining active `stage='encumbrance'` row, leaves every `stage='actual'` row unchanged, repairs the consumed projection from active actual evidence, writes audit/outbox evidence, and then commits `PO_CLOSED`. A closed retry returns before financial or event writes. A fully actualized PO with no active encumbrance closes without fabricating a release.

The production-writer search does **not** support claiming zero legacy code. `controllers/rfxPortalController.js` still directly inserts purchase orders, and `financeCoreService.js` remains a pre-existing direct commitment-ledger writer. `procureToPayPersistenceService` also retains legacy receipt/invoice SQL, although prior call-site audits found no live cut-over controller caller. These are remaining production-surface risks outside the connected repository and should be removed, delegated, or conclusively proven unreachable before declaring all Phase 4 financial-effect writing canonical.

SQL 006 preflight now catalog-guards and dynamically executes diagnostics involving columns introduced by SQL 006, including `commitment_ledger.ap_voucher_id` and `commitment_ledger.state`; the complete requested self-introduced-column list was audited. This makes review of SQL 006 safe for a pre-006 schema without allowing preflight to mutate it. Manual execution is recommended only after DBA review, backup, prerequisite reconciliation, and confirmation of live schema/FKs; it was not executed in this work session.

No SQL was executed against Supabase.

## Connection-and-schema correction addendum (2026-08-11)

The authority is `public.requests(id INTEGER)`, not `purchase_requests`; invoice PO linkage is `purchase_order_id`. Document PKs are BIGINT while request, item, supplier and user PKs are INTEGER. SQL 006 fails if a base table is absent, preflights invalid legacy data, extends `commitment_ledger`, and creates no parallel budget/payment subsystem.

`repositories/connectedP2PRepository.js` performs real `requested_items FOR UPDATE`, active-award sum, award insert, supplier and compliance queries. Services now enforce fingerprints, inherited PO provenance, supplier equality, cumulative invoice quantity, existing budget authority, and scaled-integer money. Live endpoints are in `routes/procureToPay.js` and `routes/requestedItems.js`; exact remaining writers are in the closure report. Controller cutover, PostgreSQL race tests, normalized contract-line pricing, category qualification and blacklist registries remain gaps because SQL was not deployed and no database was connected.

Prerequisites: backup; reconcile invoice duplicates, NULL PO suppliers, orphan items, duplicate idempotency values and award-like fields; deploy the 2026-03-12/13 foundations; review SQL 006 preflight; then enable adapters. Jest covers fingerprints, locked award ceilings, PO inheritance/wrong supplier, cumulative matching, payments, completion, totals, eligibility and pricing.

No SQL was executed against Supabase.
## Phase 4D finance connectivity addendum

The intended chain is: **Approved Request → Award → PO → Encumbrance → Receipt → Inventory → Invoice → Match → Finance Verification → AP Liability → Actualization → Payment → Completion**.

Authoritative services are `supplierInvoiceService`, `financeVerificationService`, `accountsPayableService`, `paymentService`, purchase-order/cancellation services, and the connected repository transaction boundary. Invoice/lifecycle/request completion fields and `budget_envelopes.consumed_amount` are derived projections. Remaining legacy paths are listed in the finance cutover and disconnected-write closure documents.

SQL 006 must receive DBA review and pass diagnostics for duplicate payables/idempotency, invalid balances, over-allocation, inconsistent encumbrances, orphan postings, and status-only historical payments. A complete atomic AP posting/partial actualization service and governed account mapping remain rollout prerequisites.