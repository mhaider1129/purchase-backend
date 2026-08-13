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