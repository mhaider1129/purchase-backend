# Phase 4 production cutover closure

## Live controller migrated

`procureToPayController.createPurchaseOrder` accepts only award IDs and quantities and delegates to `purchaseOrderService.createPurchaseOrderFromAwards`. It no longer calculates totals, accepts caller prices, copies supplier identity, or creates traceability.

## Real repository methods

`connectedP2PRepository` is bound to one supplied PostgreSQL client. It provides entity-specific operations for award locks/inserts/remaining quantity; PO headers, lines, locks, loads, totals and release; budget locks, commitments and release; receipt locks, cumulative receipt quantities and inserts; invoice identity locks, PO/prior invoice loads, invoice/line/match inserts and lifecycle; and invoice locks, posted payment totals, payment inserts and AP lifecycle. `createTransactionalP2PRepository` owns BEGIN/COMMIT/ROLLBACK.

## Award to PO quantity control

Partial conversion is supported. Awards lock in ID order. Under that lock, active/non-cancelled PO quantities are subtracted from awarded quantity and excess is rejected. Therefore 60 + 40 of 100 succeeds, a further 1 fails, and competing 70 conversions serialize so only one can commit. SQL 006 intentionally has no `UNIQUE(award_id)` and adds a covering `(award_id, purchase_order_id) INCLUDE (quantity)` index.

## Budget transaction model

The adapter locks `budget_envelopes` `FOR UPDATE`, sums active `commitment_ledger` encumbrances, performs idempotency lookup, inserts encumbrances, and releases commitments without deleting history. Numeric strings preserve exact-decimal service arithmetic.

## Receipt integration model

The adapter locks PO lines, calculates cumulative valid receipts, and inserts idempotent receipt headers/lines carrying `line_type`. The existing `goodsReceiptInventoryAdapter` remains the only stock route. The live receipt controller remains a compatibility writer pending final coordinator cutover.

## Invoice and matching cutover

Repository operations use canonical `purchase_order_id`, transaction advisory-lock supplier/invoice identity, insert headers/lines, load prior valid invoices, persist structured matches, and update lifecycle. Live invoice/match controllers remain outstanding.

## Payment cutover

Repository operations lock invoices, total posted payments, enforce payment idempotency storage, insert physical records, and update invoice/AP state. Legacy controller payment paths remain outstanding and must delegate before final closure.

## Requested-item projection strategy

The selected strategy is a compatibility projection updated only after canonical commits. Direct legacy endpoints are not all disabled yet, so this closure remains outstanding.

## Remaining direct writers

Canonical SQL is confined to the repository. Search also found production compatibility writers: `rfxPortalController` inserts POs; `procureToPayController` updates PO receipt/approval/issue/cancel/close states and writes legacy payments; `procureToPayPersistenceService` inserts legacy invoices. No exact direct writer was found for the four requested-item search strings. These results are explicitly classified as outstanding, not migrated.

## Corrected SQL 006

SQL 006 adds only the partial-conversion covering index required by this pass. It was not executed.

## Controller/integration tests and results

The controller test imports the actual controller, mocks the canonical service boundary, proves award delegation, and proves arbitrary legacy line pricing is rejected. Connected behavior tests cover inherited traceability and 60/40/1 award accounting. Targeted result: 2 suites and 15 tests passed. Full result: 82 suites/452 tests passed; 2 suites/3 unrelated pre-existing tests failed in warehouse inventory mocks and warehouse-transfer route assembly.

No SQL was executed against Supabase.