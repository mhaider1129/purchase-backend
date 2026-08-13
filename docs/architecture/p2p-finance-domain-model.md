# Connected P2P finance domain model

## Authorities

`Supplier Invoice → effective match approval → AP Voucher → AP Payable → Finance Posting → Payment Record → Payment Allocation`.

* `supplier_invoices` is commercial invoice identity and backend-derived gross amount. Its finance/payment status is only a lifecycle projection.
* The latest match plus immutable override decision is the match authority; finance uses `assertInvoiceMatchApproved()`.
* `ap_vouchers` and lines are the accounting document. Debits must equal credits exactly and the liability credit reconciles to the DB invoice total. Account codes remain a governed finance input because no complete inventory/expense/asset/tax/freight/AP mapping master was found; deployment must not fabricate mappings.
* `ap_payables` is liability/open-balance authority. One active payable is permitted per invoice. Its balance is synchronized under lock from posted allocations.
* `finance_postings` is posting evidence; it must be created only by the future atomic POST AP operation.
* `payment_records` describes a payment instrument/event; `payment_allocations.amount` is the amount applied to a payable. Allocation sums, not invoice status, prove settlement.

## Budget authority

`PO encumbrance → partial actual rows and reduced remaining encumbrance → unused release`. Ledger rows are transactional authority. `budget_envelopes.consumed_amount` is a repairable projection synchronized only by the commitment service. Availability is `allocated - active encumbrance - actual`; replacing encumbrance with actual does not count the same amount twice.

For a 1,000 PO and 600 invoice, posting creates immutable actual evidence of 600 and leaves active encumbrance 400. A later 300 leaves 100. Final cancellation releases 100; actual remains 900. Actualization is keyed by invoice/AP posting and occurs in the same transaction as finance posting, audit, and outbox.

## Payment and completion

Payment idempotency fingerprints payable, exact amount, currency, reference, and method. A payable lock serializes competing payments. A 40 allocation against 100 yields balance 60 and `PARTIALLY_PAID`; a subsequent 60 yields zero and `PAID`; 61 is rejected. Reversal is deferred and posted payments must not be edited/deleted.

Request financial completion is derived only when all active invoices are terminal, every payable is settled/closed, and no unresolved active commitment or financial obligation remains. Receipt completion alone and one paid PO in a multi-PO request cannot close the request.