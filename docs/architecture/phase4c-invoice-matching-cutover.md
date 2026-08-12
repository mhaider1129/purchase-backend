# Phase 4C invoice and matching cutover

## Audit findings (completed before implementation)

The live controller previously owned invoice transactions, trusted browser totals, inserted through `procureToPayPersistenceService`, and posted finance/request lifecycle side effects. Matching accepted caller policy/tolerances, compared aggregate arrays and one receipt, persisted legacy `MATCHED`/`MISMATCH`, and mutated results for overrides. The disconnected invoice/matching services were not live. No service-confirmation/receipt model and no governed tolerance configuration were found.

## Writer classification

| Target | Writer | Classification / disposition |
|---|---|---|
| `supplier_invoices`, `invoice_items` | `supplierInvoiceService` via `connectedP2PRepository` | **CANONICAL** |
| same | `procureToPayPersistenceService.insertSupplierInvoice` | **LEGACY / TO_DISABLE**; removed from live controller |
| `invoice_match_results` | canonical coordinator/repository | **CANONICAL**, append-only history |
| same | former controller SQL | **TO_MIGRATE**, now disabled |
| match override columns | former controller SQL | **DUPLICATE / TO_DISABLE** |
| `invoice_match_override_decisions` | canonical override coordinator | **CANONICAL** evidence |
| invoice status | repository `updateInvoiceLifecycle` | **CANONICAL** |
| request lifecycle/history | lifecycle service | **PROJECTION**, no longer invoice authority |
| payable/payment status | AP/payment services | **PROJECTION**, unchanged/deferred |
| finance ledger state | former submission controller | **TO_MIGRATE** in later AP phase; removed from submission |
| `audit_logs` / `notification_outbox` | shared services | **CANONICAL** audit/outbox writers |
| contract invoice tables | contracts controller | **LEGACY, OUT OF SCOPE**, separate domain |

## Canonical submission and identity

`submitSupplierInvoice({ repository, purchaseOrderId, supplierId, invoiceNumber, invoiceDate, currency, lines, idempotencyKey, actor, attachmentMetadata, auditService, outbox })` owns the transaction. Identity is `supplier_id` plus trim/lower-case `normalized_invoice_number`; the visible trimmed number is preserved. Only `PO_ISSUED`, `PO_PARTIAL`, and `PO_DELIVERED` qualify. Every invoice line names a PO item belonging to that PO; requested-item identity and description are server-derived.

The transaction takes the operation advisory lock, checks the durable key/fingerprint, takes the invoice-identity lock, checks duplicates, locks/validates the PO, loads PO lines, calculates totals, writes header/lines plus audit/outbox, and commits. SHA-256 covers supplier, PO, normalized number, date, currency, and ordered line identities/quantities/prices/tax/discount. Identical retry returns existing data without duplicated evidence; changed payload returns `IDEMPOTENCY_CONFLICT`.

Caller subtotal/tax/total are ignored. Shared scaled-integer arithmetic accepts four decimal inputs; each line/document monetary amount is half-up rounded to two decimals. Invoice price is retained separately from PO price and is only a match input.

## Matching, receipts, and concurrency

Non-service lines use exact 3-way matching. Accepted receipt quantity is `received - damaged - short` across all receipts. Accepted quarantined quantity presently counts because Phase 4B separates financial acceptance from stock availability and contains no quality-release financial authority; this explicit governance choice should be revisited when quality release exists. Service lines use exact 2-way PO/invoice matching because no service confirmation exists; no fake receipt is created.

The coordinator ignores caller arrays, totals, tolerance, and policy. It locks invoice and PO, then loads invoice/PO lines, accepted receipts, and prior valid invoice quantities/values. `CANCELLED`, `DECLINED`, `VOIDED`, and `MATCH_EXCEPTION` do not consume capacity; other submitted/pending/verified invoices do. The PO lock serializes competing matches. It checks prior + current quantity against accepted and ordered quantity, and prior + current value against PO line value.

Structured codes are `QUANTITY_VARIANCE`, `PRICE_VARIANCE`, `VALUE_VARIANCE`, `MISSING_RECEIPT`, `SUPPLIER_MISMATCH`, `CURRENCY_MISMATCH`, `PO_LINE_NOT_FOUND`, and `OVER_INVOICED`, with line identity, expected/actual/difference, currency/UOM as applicable. Persisted states are `MATCH_VERIFIED` and `MATCH_EXCEPTION`; each run appends history.

## Overrides, cancellation, and frontend

The existing `finance.override-mismatch` permission governs override. A reason is mandatory, only an exception may be decided, and actor/time/decision/reason/original variances are appended. Approval advances invoice status; decline retains the exception. Invoice deletion is prohibited; cancellation UI/process is deferred, paid invoices require future credit/reversal, and terminal invalid statuses are excluded from cumulative controls.

The API accepts PO/supplier IDs, number/date/currency, idempotency key, and PO-line-bound lines. Compatibility `items` is accepted but no free-text identity, caller totals, receipts, prior invoices, or results are authoritative. Existing pages still require UX work for PO/line selection. Matching calls can no longer weaken server policy; screens should render server totals and structured variances.

## Remaining direct writers

Runtime literals remain in `connectedP2PRepository` (**CANONICAL**) and the unreferenced legacy persistence helper (**LEGACY / TO_DISABLE**). Migration/bootstrap SQL is schema provisioning, not a business writer. Unrelated `contract_invoices` writes remain a separate domain. The four live migrated controller methods contain no invoice/match SQL.