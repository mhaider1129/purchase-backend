# Phase 4D finance cutover

## Audit and writer classification

| Writer | Prior behavior | Classification / cutover |
|---|---|---|
| `verifyFinanceRecord` | matched every historical request invoice, then directly wrote request finance state | **TO_MIGRATE → CANONICAL coordinator**: selects positively eligible invoices and delegates each verification to `financeVerificationService` |
| `createApVoucher` | trusted caller total and inserted voucher/lines | **DUPLICATE / TO_DISABLE → CANONICAL service**: caller total is ignored; DB invoice total and balanced lines govern |
| `postPayableFromInvoice` | directly inserted an open payable | **LEGACY ACTIVE / TO_DISABLE**; payable creation belongs to `accountsPayableService` |
| `postToInternalLedger` | caller supplied liability amount and inserted `finance_postings` | **LEGACY ACTIVE / TO_MIGRATE**; must be replaced by atomic AP posting/actualization before deployment |
| `recordPayablePayment` | floating point balance arithmetic and direct payment/allocation/balance writes | **TO_MIGRATE → CANONICAL service** |
| `markPaymentPending` | creates a zero-value scheduling record | **PROJECTION** only; it has no payment allocation and must never establish paid state |
| `markPaid` | status-only payment and request close | **TO_DISABLE**; endpoint now returns a controlled 410 |
| `paymentService` | invoice-oriented payment writer | **DUPLICATE → CANONICAL payable-oriented authority** |
| `financeCoreService` / `budgetControlController` | reservations, encumbrances and generic journals | **CANONICAL** for existing stages; floating-point reporting remains **TO_MIGRATE** |
| `p2pCancellationService` | releases active encumbrance | **CANONICAL**, provided it releases only remaining encumbrance |
| `p2pCompletionService` | compared aggregate amounts using `Number` | **TO_MIGRATE → derived projection**, evaluated across all request facts |
| `procureToPayPersistenceService` | compatibility lifecycle persistence | **PROJECTION**; may not originate AP/payment facts |
| frontend lifecycle quick actions | allowed caller totals and status-only paid | **LEGACY ACTIVE / TO_DISABLE** pending UI replacement; backend refuses status-only paid |

The remaining production blockers are the direct `postPayableFromInvoice`, `postToInternalLedger`, and scheduling writer. They are deliberately called out rather than falsely represented as completed. `ap_payables.open_balance` is the synchronized balance authority; payment allocations are the reconstructable evidence. Invoice, lifecycle, and request statuses are projections.

## Permissions

Existing permission codes are retained: `finance.verify`, `finance.voucher.create`, `finance.voucher.verify`, `finance.voucher.post`, `finance.payment.manage`, and `finance.override-mismatch`. Existing controller fallback roles are compatibility behavior, not new finance role shortcuts.
# Final Phase 4D accounting bridge

The selected lifecycle is **Model A**: finance verification permits creation of a
`draft` voucher, verification changes only that voucher to `verified`, and the
canonical AP posting transaction creates the `OPEN` payable only when it changes
the voucher to `posted`. `ap_payables.ap_voucher_id` makes invoice → voucher →
payable explicit. Draft and verified vouchers therefore have no payment-eligible
liability.

`apPostingService.postApVoucher` is the sole AP posting orchestration boundary. It
uses a posting-specific idempotency key and operation lock, derives liability and
currency from the locked invoice/voucher, creates the finance posting and an
immutable `actual` commitment row, and reduces the locked mutable active
encumbrance. Thus a 1,000 commitment actualized by 600 is represented as 600
actual plus 400 remaining—not 1,600 consumed. `budget_envelopes.consumed_amount`
is a repairable projection of active `actual` rows and is synchronized only here.

Payments require an `OPEN`/`PARTIALLY_PAID` payable linked to a `posted` voucher
and an authoritative persisted payable currency. Payment allocations, rather
than payment header amounts, are settlement truth. The legacy pending-payment
and status-only paid endpoints return 410. Request finance verification first
checks every non-terminal invoice and reports unresolved IDs; cancelled/voided
invoices are excluded.

Legacy payables without vouchers, paid headers without allocations, and finance
postings without actualizations are reported by SQL 006 preflight for manual
reconciliation. The migration deliberately does not fabricate accounting events.