# Phase 5A.2 UOM and conversion inventory

Repository-wide searches covered `UOM`, `unit_of_measure`, all `*_uom*`, conversion/package/order fields, quantity snapshots, both conversion-table names, and conversion services.

| Structure / exact fields | Purpose and kind | Writers / readers / activity | Dependencies and overlap | Classification |
|---|---|---|---|---|
| `item_uom`: `id,uom_code,uom_name,description,is_base_uom,is_active,normalized_uom_code,created_by,updated_by` | Controlled unit identity | Foundation reference API/service/UI; master repositories/forms; active | FK target for controlled UOM IDs | **AUTHORITATIVE_REFERENCE** |
| `generic_items`: `base_uom,inventory_uom,purchasing_uom,base_uom_id,inventory_uom_id,purchasing_uom_id,conversion_rules` | Generic physical/ledger UOM and old text/JSON | Foundation writes; hierarchy/inventory creation reads; active | IDs overlap text; purchasing differs by catalog; JSON overlaps conversions | IDs **AUTHORITATIVE_REFERENCE**; text **PROJECTION/LEGACY**; purchasing **TO_MIGRATE**; JSON **TO_RETIRE** |
| `approved_products`: `product_uom,product_uom_id,package_quantity,inventory_conversion_factor` | Product packaging | Product create; catalog/search read; active | factor duplicates quantity when base=inventory | ID+quantity **PACKAGING_METADATA**; text **PROJECTION**; factor **DUPLICATE** |
| `supplier_catalog_items`: `purchasing_uom_id,purchasing_uom,conversion_factor,package_size,minimum_order_quantity,order_multiple` | Supplier commercial pack/rules | Catalog create/update; PO selection/search read; active | controlled ID plus text snapshot; package size ambiguous | ID **AUTHORITATIVE_REFERENCE**; conversion **PACKAGING_METADATA**; MOQ/multiple **COMMERCIAL_ORDERING_RULE**; text **PROJECTION/LEGACY**; package size **LEGACY** |
| `stock_items.inventory_uom_id` and legacy `unit/inventory_uom` | Ledger unit | Governed inventory creation; inventory posting reads | Must reference active UOM | ID **AUTHORITATIVE_REFERENCE**; text **PROJECTION** |
| `item_conversion`: `item_master_id,from_uom_id,to_uom_id,conversion_factor,is_bidirectional` | Per-legacy-master conversion | Runtime table ensure; no canonical reader/writer | Bound to legacy identity; overlaps package/global ratios | **LEGACY, TO_RETIRE** (not dropped) |
| `item_uom_conversions` | Universal-conversion migration foundation; absent from deployed schema and production code | No current reader/writer | Direct/path resolution and governance are deferred | **MIGRATION FOUNDATION / DEFERRED**, not runtime authority |
| legacy `item_master.base_uom_id`, `item_master_items.unit_of_measure`, package helpers | Contained Item Master | Legacy controllers/runtime ensures | Not canonical | **LEGACY** |
| `requested_items.unit_of_measure`, `pending_item_requests.requested_uom` | Requested unit text | Request flows | No controlled identity guarantee | **SNAPSHOT, TO_MIGRATE** |
| `purchase_order_items.quantity,unit_price,received_quantity` | Commercial quantities/pricing | PO writes; GR reads | deployed schema lacks UOM/conversion | **SNAPSHOT, TO_MIGRATE** |
| `goods_receipt_items.received_quantity,source_uom,base_uom,conversion_factor` | Receipt source quantity/conversion | GR writes; adapter reads | frozen from PO | **SNAPSHOT** |
| `inventory_transactions.quantity,base_uom,source_quantity,source_uom,conversion_factor` and allocations | Ledger quantity/provenance | Posting service/repository | quantity already inventory UOM | result **AUTHORITATIVE_CONVERSION**; provenance **SNAPSHOT** |
| mapping `source_uom,source_quantity_snapshot` | Import evidence | Mapping services | Never master data | **SNAPSHOT** |
| `uomConversionService` | Calculation/validation | Product/Catalog/GR and tests | Replaces Number arithmetic on canonical paths | **AUTHORITATIVE_CONVERSION** service |

## Why two conversion names existed

`item_conversion` exists because the reachable legacy runtime initializer created a table tied to `item_master`; canonical code neither reads nor writes it. `item_uom_conversions` did not exist in the deployed snapshot and had no implementation reader/writer: it was an architectural intention. The survivor is a narrowly governed `item_uom_conversions` for universal ratios only. `item_conversion` remains legacy compatibility without new canonical writes.

## Direct writers

`ItemMasterFoundationService` writes canonical references/Product/Catalog packaging. `InventoryItemCreationService` projects the validated inventory UOM to stock. Goods Receipt and Inventory Posting write snapshots/results. Runtime `ensureItemMasterTables` is the only `item_conversion` DDL path; no production DML writer was found. No writer may create global packaging conversion.

## Phase 5A.2 conversion decision and arithmetic

`approved_products.package_quantity` has one meaning: **Generic base-UOM units per Product UOM**. Thus `BOX` with `package_quantity = 100` means `1 BOX = 100` Generic base units; it does not independently mean inventory units. The compatibility `inventory_conversion_factor` equals `package_quantity` only when the Generic base and inventory UOM IDs are identical.

Phase 5A.2 does not activate `item_uom_conversions` as runtime authority. Until a governed resolver exists, a Generic whose base and inventory UOM IDs differ fails closed with `GENERIC_INVENTORY_UOM_CONVERSION_REQUIRED`.

Supplier Catalog `conversion_factor` is Product UOMs per Supplier Purchasing UOM. A governed PO snapshot multiplies that supplier factor by Product `package_quantity` only after proving that Generic base UOM and inventory UOM are the same controlled identity. For example, `1 CASE = 10 BOX` and `1 BOX = 100 EA` snapshots `CASE`, `EA`, and factor `1000`. Goods Receipt and inventory posting consume that immutable PO snapshot rather than current master data or caller values.