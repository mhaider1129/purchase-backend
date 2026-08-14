# Phase 5A transaction item traceability

## Current chain

`requested_items` can hold a Generic plus preferred or mandatory Product. `procurementItemIdentityService` validates the selected active Generic/Product, derives snapshots, governs free-text permission and supports service/pending modes. Sourcing and award retain request-line identity and descriptive snapshots, but do not consistently select an awarded Product or Supplier Catalog Item. PO schema has all three canonical FKs, while Phase 4 writers remain request-item/description oriented.

Goods receipt resolves the first `stock_items` row whose `generic_item_id` equals the request line Generic. It does not discriminate Approved Product, UOM, institute or supplier offer. The receipt insert writes `requested_item_id`, names/tracking and `stock_item_id`, but omits its Generic/Product/Catalog columns. The adapter then posts inventory using the stock item and tracking fields. Consequently Generic may be indirectly recoverable through stock; exact Product and Supplier Catalog generally do not survive PO → GR → movement.

| Hop | Populated today | Commonly null/not represented | Gap |
|---|---|---|---|
| Request | Generic and preferred/mandatory Product on governed paths; snapshots. | Generic on service, pending, exception and older paths. | Several create/edit/import controllers predate the validator. |
| RFx/award | Request line, description, quoted/awarded price. | Explicit awarded Product and Catalog. | Preference/mandatory semantics are not a complete award identity. |
| PO line | Request-line link, name/description, awarded price. | Generic/Product/Catalog despite schema columns. | Canonical propagation absent/inconsistent. |
| GR line | PO/request link, stock item, batch/lot/serial/expiry. | Generic/Product/Catalog columns. | Generic-only first-match stock resolution is ambiguous. |
| Inventory movement | Stock item and physical tracking/allocation. | Generic/Product/Catalog movement columns. | Product recall cannot reliably traverse movements. |

## Target (not implemented in this batch)

REQUESTED GENERIC ITEM → AWARDED APPROVED PRODUCT → SUPPLIER CATALOG ITEM → PO LINE → GOODS RECEIPT → STOCK ITEM/PRODUCT → BATCH/SERIAL → INVENTORY TRANSACTION.

The future implementation must copy IDs as transaction facts rather than re-resolve by mutable names. For generic awards, receiving must record the actual approved product before posting whenever product traceability is required. Catalog identity must identify the supplied offer but never recalculate an awarded price. Batch/serial/expiry allocations can already attach to `stock_item_id`; product-level stock mapping makes those records recall-capable.

## Recommended inventory policy

Adopt hybrid authority: Generic for demand/interchangeability, optional Product-specific stock for ordinary interchangeable supplies, mandatory Product-specific stock for batch/serial/expiry/recall/regulatory-controlled items. Do not automatically select `ORDER BY si.id LIMIT 1`; require a deterministic mapping compatible with the award, warehouse/institute and UOM.