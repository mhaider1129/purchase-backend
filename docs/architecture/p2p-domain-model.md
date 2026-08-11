# Authoritative P2P domain model

The existing request assignment is the **procurement case**: approved request + assigned officer is its root. No redundant `procurement_case` table is introduced. RFx quotations, evaluations, awards and resulting documents connect through request/request-item keys.

## Cardinalities
* Purchase request **1:N** request items.
* Request/request assignment **1:N** sourcing activities and quotations.
* Request item **1:N** awards; sum of active awards cannot exceed approved quantity. One award has one supplier; split 60/40 is valid.
* Request **1:N** POs and request item **1:N** PO lines/POs. A PO has one supplier, so supplier splits naturally produce multiple POs.
* Award **1:N** PO lines over partial ordering, bounded by unconsumed award quantity.
* PO **1:N** lines, receipts, invoices and commitments over time (only one active formal commitment).
* PO line **1:N** receipt lines and invoice lines.
* Invoice **1:N** payment allocations/payments; one payment may allocate to invoices where the existing allocation table permits it.

## Aggregate ownership
`procurement_awards` owns the durable selection decision. PO lines own frozen commercial terms and provenance. Receipt lines own accepted quantities. Inventory ledger owns stock. Supplier invoice/match records own AP eligibility. Payment records/allocations own settlement. Completion is derived, never a shortcut writer.

Line types are `INVENTORY`, `NON_INVENTORY`, `SERVICE`, and existing asset/device variants. Inventory receipts use the canonical adapter; service confirmation and non-inventory receipts never mutate warehouse balances. Asset/device lines must connect to the existing device workflow before activation.

Pricing hierarchy, where applicable, is: effective applicable contract line; awarded quotation/framework price; approved direct-purchase price; authorized manual exception. No external FX feed exists: currency and any approved exchange rate/date/base amount are frozen on the PO.