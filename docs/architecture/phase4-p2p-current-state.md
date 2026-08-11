# Phase 4 P2P current-state audit

## Method and scope
Repository-wide searches covered backend SQL/routes/controllers/services and frontend APIs/pages for PO, sourcing, quotations, supplier evaluation/selection, contract pricing, budget/commitment, receipt/GRN, invoice/matching/AP, payment, currency/tax/discount/total, and request procurement fields. This audit preceded Phase 4 code changes.

## Implementation register
| Fact/capability | Existing implementation | Classification | Phase 4 disposition |
|---|---|---|---|
| Request demand/assignment | `requested_items`, assignment controllers, procurement item events | AUTHORITATIVE (demand); TO-MIGRATE (commercial writes) | Reuse assignment as procurement case; retain request fields as projections |
| Supplier master | `suppliers`, supplier authorization/reference services | AUTHORITATIVE | All new commercial records use `supplier_id` |
| Supplier name on request/PO/evaluation/inspection | request, P2P, evaluation and inspection controllers | LEGACY / DISCONNECTED | Display snapshot only; active selection must resolve master ID |
| Supplier sourcing | RFx portal, procurement/supplier evaluations | DISCONNECTED | Quotations/evaluation feed durable award; do not copy winner only to request |
| Contract system/prices/payments | contracts controllers and contract governance | AUTHORITATIVE for contracts; DUPLICATE for AP payment | Reuse applicable contract rate; migrate contract payment posting to P2P payment service |
| Request `unit_cost` and procurement item event cost | request create/update/item-event controllers | PROJECTION / LEGACY | Estimate/history only, never PO price authority |
| PO documents | `purchase_orders`, `purchase_order_items`, P2P controller | TO-MIGRATE | PO service owns creation/release; lines reference request item + award |
| PO totals | controller/UI numeric calculations and `procureToPayService.summarizeItems` | DUPLICATE / TO-DISABLE | decimal-safe totals service is authority |
| Budget | `budget_envelopes`, `commitment_ledger`, finance core/budget controller | AUTHORITATIVE structures; DISCONNECTED release | lock envelope and write one PO commitment during PO release |
| Goods receipt | P2P controller/tables | TO-MIGRATE | line/idempotency enforcement; inventory types call existing adapter |
| Inventory posting | `goodsReceiptInventoryAdapter` -> inventory posting service | AUTHORITATIVE | unchanged and reused |
| Request received quantities | request update/reminder controllers | PROJECTION / DUPLICATE | derive from receipt lines; close active direct writers |
| Supplier invoice/items | P2P invoice controller/tables | TO-MIGRATE | supplier invoice service owns identity/submission |
| Matching | `procureToPayService.performInvoiceMatch`, controller | TO-MIGRATE | structured exact two/three-way engine |
| Payment records/allocations | P2P controller/tables | TO-MIGRATE | payment service owns idempotent posting/overpayment lock |
| Contract payments | contract controller | DUPLICATE | keep history, route future supplier invoice payments centrally |
| Request `procurement_status` | multiple requested-item controllers | DUPLICATE / PROJECTION / TO-DISABLE | completion service derives three separate dimensions |
| PO/invoice/payment statuses | P2P service/controller | AUTHORITATIVE per aggregate, partly DISCONNECTED | central transition coordinators connect them |
| Notifications | notification outbox service/processor | AUTHORITATIVE | enqueue transactionally; delivery after commit |
| Audit | shared audit service plus historical tables | AUTHORITATIVE / LEGACY | use shared service; retain historical logs |

## Multiple representations of the same fact
* **Price:** contract rate, quotation/award price, `requested_items.unit_cost`, PO line price, receipt valuation, invoice price. Contract/award/direct-exception provenance governs PO price; later values are separate facts or projections.
* **Supplier:** master `supplier_id`, request/PO/evaluation `supplier_name`, quotation supplier, contract supplier, invoice supplier. Master ID is identity; names are immutable/display snapshots.
* **Quantity progress:** approved request, awarded, ordered, received, invoiced and paid quantities/amounts are distinct. Request received/status fields are projections.
* **Completion:** request procurement status, PO status, receipt status, invoice/AP status and payment status cannot be one writable flag.
* **Money use:** request estimate, reservation/commitment, actual and payment are different accounting stages; payment is settlement, not another expense.

## Permission findings
The repository uses route permissions/capability policies but also contains role-oriented checks in older controllers. Existing equivalents must be mapped before enabling endpoints; institute/department predicates belong in every repository query. Phase 4 does not seed speculative permissions.