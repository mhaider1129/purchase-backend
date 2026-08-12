# Phase 4 disconnected-write closure

| Exact writer | State | Disposition |
|---|---|---|
| `controllers/procureToPayController.js:createGoodsReceipt` | GR, PO received projection, inventory | **Remaining compatibility coordinator.** It reuses `goodsReceiptInventoryAdapter`; migrate validation/idempotency without a second inventory path. |
| `controllers/procureToPayController.js:createPurchaseOrder` | PO header/items/totals | **Remaining legacy writer.** `purchaseOrderService.createPurchaseOrderFromAwards` is canonical after SQL deployment. |
| `controllers/procureToPayController.js:submitPurchaseOrderForApproval`, `approvePurchaseOrder`, `issuePurchaseOrder` | PO lifecycle | **Remaining.** Release must call atomic budget commitment after deployment. |
| `controllers/procureToPayController.js:submitInvoice` | invoice/items | **Remaining.** Canonical service enforces `purchase_order_id` and supplier equality. |
| `controllers/procureToPayController.js:runInvoiceMatch`, `approveMatchOverride`, `declineInvoiceMatch` | match/invoice status | **Remaining.** Engine supports repository-fed prior invoices; query cutover remains. |
| `controllers/procureToPayController.js:recordPayablePayment`, `markPaymentPending`, `markPaid` | AP/payment | **Remaining.** Decimal-safe service requires deployed invoice linkage. |
| `controllers/requests/procurementItemEventsController.js` | item supplier/cost/status | Legacy projection; awards are authority. |
| `controllers/requestedItemsController.js:updateItemCost`, `updateItemProcurementStatus`, `updateItemPurchasedQuantity` | item projections | Remaining legacy endpoints. |
| `controllers/requests/updateRequestsController.js:receiveItem`, `addReceivedQuantity` | receipt projection | Remaining duplicate path; retire after GR cutover. |
| `controllers/contractsController.js` payment/consumption functions | contract projections | Separate legacy projection, not AP authority. |

## Canonical authority

Award service locks `requested_items`; PO service inherits award traceability; budget service sums active `commitment_ledger` encumbrances under an envelope lock; the existing receipt/inventory adapter remains the only stock posting route; invoice, matching, and payment services own their rules after route cutover; completion remains derived. No controller is falsely labelled migrated merely because a disconnected service exists. SQL 006 deployment is a prerequisite.