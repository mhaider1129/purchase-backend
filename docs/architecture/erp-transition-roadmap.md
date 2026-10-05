# ERP transition: implementation roadmap

This roadmap follows the existing modular monolith and governed P2P services.
It records implementation evidence separately from deployment readiness. Older
phase documents describe earlier snapshots and must be checked against current
writers and the deployed database before work is repeated.

## Business target

Complete approved demand through sourcing, commitment, goods/service acceptance,
invoice matching, liability posting, settlement and financial closure. Preserve
line-level provenance into stock, assets, custody, maintenance and recall records.
Procurement closure and the continuing asset lifecycle are separate outcomes.

The general-ledger ownership decision is pending: own financial close here or
integrate with another accounting system. Do not invent account mappings,
recognition policies, taxes, capitalization thresholds or currency rules while
that decision is pending. The first controls apply in either architecture.

## Current evidence and authority

| Fact | Current boundary | Finding / next action |
| --- | --- | --- |
| PO, receipt, invoice, AP and settlement | `purchaseOrderService`, `goodsReceiptService`, `supplierInvoiceService`, `accountsPayableService`, `apPostingService`, `paymentService` | Build on existing transaction, scope, idempotency, audit and outbox controls. |
| Supplier obligation for contracts | `contractsController.createContractInvoice/createContractPayment` and routes in `routes/contracts.js` | Active independent invoice/payment writers remain. Inventory existing data and contract-specific terms before centralizing AP. |
| Goods acceptance and stock | `goodsReceiptService` and inventory adapter | Accepted quantity and available stock are distinct. Agree quality release and financial-hold policy. |
| Service acceptance | `invoiceMatchingService` | SERVICE lines use two-way matching. Add approved service entry/milestone acceptance and governed matching policy. |
| Debit/credit integrity | Shared accounting-entry validator | First implementation milestone below. |
| Financial completion | `p2pCompletionService` | Already separates procurement, receipt and finance completion. Verify aggregation across multiple POs/invoices and exception paths. |
| Physical item traceability | PO/receipt writers, stock resolution, Phase 5A audits | Recheck current identity propagation and deployed rows; use product, UOM, institute and batch/serial evidence for deterministic mappings. |
| Structural authority | Organization services and approval policies | Effective position authority and application permissions are distinct. Verify the live policy cutover before replacing legacy routing. |
| General ledger | `financeCoreService` and posting records | Posting-period, source uniqueness, account-master validation, reconciliation and reversal policies require further work. AP posting evidence is not proof of complete GL integration. |

## Milestone 1: exact accounting-line integrity

Implemented `accountingEntryValidation.js`, used by AP voucher creation,
verification, posting and the general journal writer. It validates every line
before financial mutation:

- Values are finite non-negative decimal numbers/strings representable by the
  existing `NUMERIC(14,2)` columns. Insignificant trailing zeroes remain accepted.
- Each line has exactly one positive debit or credit; empty/two-sided lines fail.
- Integer-cent arithmetic proves that debits equal credits and both equal the
  authoritative source total. No line or aggregate is silently rounded.
- The journal header total is a validated decimal string, and each journal line
  must supply an account code. Code existence is a future account-master control.
- AP's invoice total remains server-owned. Existing idempotency and transaction
  orchestration are retained. Posting retries continue to return prior evidence.

For example, debit lines 0.004 + 0.004 could previously compare as 0.01 after
aggregation while each line stored as 0.00. The new control rejects those inputs.
It also rejects negative lines that could cancel one another in aggregate totals.

This enforces the existing storage precision, not universal currency policy.
Currencies requiring different precision need a separately reviewed schema and
policy change across invoices, vouchers, budgets and settlement. Historical invalid
vouchers fail verification/posting and need reconciliation; do not silently edit
them or weaken validation. Existing posted data is not backfilled by this change.

Invalid inputs use HTTP 400 and specific accounting error codes. Source-total
and imbalance codes are retained for AP creation/verification. AP posting preserves
its existing HTTP 409 / `VOUCHER_INVOICE_MISMATCH` response for balance/source-total
conflicts in persisted vouchers.

The journal writer still relies on its caller's transaction for atomic persistence.
This milestone adds validation; it does not provide posting-period enforcement,
account eligibility, a full GL, or automatic accrual accounting.

## Delivery sequence and acceptance gates

1. **Database baseline and golden transaction.** Verify the approved development
   database, migration ledger and read-only P2P schema contract. Run a real-data
   transaction through partial receipts, multiple invoices, partial payments and
   remainder release; prove no early close or duplicate effects on retries.
2. **Contract liabilities and settlement.** Inventory legacy contract invoices,
   payments, advances, retention and penalties; define source-document links and
   approved acceptance. Centralize liabilities/payment allocations without forcing
   every contract milestone into a goods PO. Reconcile historical balances, review
   forward migrations, then replace writers and update contract views.
3. **Service and inspection acceptance.** Add immutable acceptance evidence and
   approval boundaries. Unaccepted services and applicable rejected/quarantined
   goods must fail the agreed invoice/payment gates. Support partial acceptance,
   disputes, cancellations, returns and credit/reversal documents.
4. **Inventory, assets and custody continuity.** Prove received identity survives
   issue/transfer, asset registration, custody and maintenance consumption. A recall
   must locate affected stock and issued assets/items and block further use.
5. **Accounting architecture.** Confirm GL ownership; enforce account and period
   policy, source uniqueness, reversals and entity/currency scope. Reconcile AP,
   stock valuation, assets and bank settlement to the selected accounting ledger.
6. **Organization, planning and analytics.** Connect effective approvals and
   segregation of duties, net demand and supply, workload and supplier performance.
   Derive reports from canonical facts with agreed KPI definitions and reconciled
   exception queues.

Every milestone must exercise authorized and unauthorized institutional scopes,
retries, simultaneous writes, audit/outbox rollback and partial/exception flows.
Unit tests alone do not establish those database behaviours. Preserve existing
records and review migration preflight/reconciliation before any shared database
changes.

## Validation and runtime limits for the first milestone

Run the focused checks from `/workspace/purchase-tracker/purchase-backend`:

```sh
npm test -- --runInBand --runTestsByPath \
  __tests__/accountingEntryValidation.test.js \
  __tests__/accountsPayableValidation.test.js \
  tests/financeCoreService.test.js \
  __tests__/phase4dAccountingBridge.test.js \
  tests/p2pBatch1Hardening.test.js \
  __tests__/connectedP2PRepositoryFinance.test.js
```

Then run the complete backend suite with `npm test -- --runInBand`. Tests cover
invalid amounts, storage precision, decimal arithmetic, no writes on validation
failure, valid draft creation/verification and the existing posting bridge. They
use mocked repository/database boundaries, not the deployed PostgreSQL instance.

Current results: focused checks passed 6 suites / 61 tests; the complete backend
regression run passed 169 suites / 1,206 tests. No tests were skipped or disabled.

The pre-existing `assetEquipmentMigration.test.js` ended mid-statement. Its
permission test was completed with assertions for both existing role-permission
mappings so the complete regression suite can execute. SQL 019 is unchanged.

DATABASE_URL and JWT_SECRET are now present. A read-only SELECT 1 connection check
failed with EAI_AGAIN for the configured Supabase destination; a control lookup of
registry.npmjs.org also failed, so this is not evidence of missing credentials or
an invalid database hostname. Restore supported PostgreSQL network connectivity
before live schema and lifecycle validation. Never print credential values or
copy them into documentation. No shared database writes or migrations were run.
