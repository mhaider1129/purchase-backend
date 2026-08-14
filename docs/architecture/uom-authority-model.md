# Phase 5A.2 UOM authority model

## Contract

| Concept | Authority | Meaning |
|---|---|---|
| Base UOM | `generic_items.base_uom_id` → `item_uom` | Canonical physical unit of a Generic Item (`EA`, `mL`, `g`). Required for non-service items. |
| Inventory UOM | `generic_items.inventory_uom_id`, projected to `stock_items.inventory_uom_id` | Sole unit of ledger movements, balances, allocations and reservations. Required for stockable items. |
| Product UOM | `approved_products.product_uom_id` | Manufactured package identity (`BOX`). |
| Product package quantity | `approved_products.package_quantity` | Generic base/inventory units in one Product UOM: `1 BOX = 100 EA`. |
| Supplier purchasing UOM | `supplier_catalog_items.purchasing_uom_id` | Commercial quantity and price unit (`CASE`). |
| Supplier conversion | `supplier_catalog_items.conversion_factor` | Product UOMs in one purchasing UOM: `1 CASE = 10 BOX`. |
| Universal conversion | governed `item_uom_conversions` | Only dimensionally universal ratios such as `L → mL`; never product packaging. |

`base quantity = supplier quantity × supplier conversion factor × product package quantity`. Operands/results are exact decimal strings. Quantity unit, package quantity, MOQ, and order multiple are distinct: MOQ is the smallest commercial order; order multiple is its increment.

`item_uom` owns identity. Global `BOX → 100 EA`, `VIAL → 10 mL`, and `CASE → 24 BOX` are forbidden because packaging is item-specific. Universal rows require non-packaging UOMs, different endpoints, a positive ratio, and explicit governance.

## Master rules

Non-service Generic Items require active controlled base and inventory UOMs. A service may omit physical UOMs only after a reviewed schema relaxation. Generic `purchasing_uom` and `purchasing_uom_id` are legacy defaults/preferences, not authority, because products and suppliers differ.

Approved Product packaging is `product_uom_id + package_quantity`. `inventory_conversion_factor` duplicates that ratio when base and inventory UOM match; canonical writers derive it from `package_quantity`, retaining it only as a compatibility projection. Manufacturer, MPN, Product UOM, or package quantity is material identity: retire and replace. No Product update endpoint exists, preventing silent mutation. Creation retains `manufacturer_id` for identity and manufacturer text as a history/display snapshot.

Supplier `conversion_factor` always counts Approved Product UOMs per purchasing UOM. `package_size` is ambiguous legacy metadata and never drives arithmetic. MOQ/order multiple are purchasing-UOM quantities. Unit price is per purchasing UOM and currency is ISO-4217. Catalog updates revalidate supplier existence, active approved Product, active Generic Item, exact packaging fields, and currency.

## Transactions and snapshots

PO `quantity` and `unit_price` mean commercial ordered quantity and price per awarded unit, but deployed `purchase_order_items` has no UOM/conversion snapshot. Migration 009 adds `source_uom`, `base_uom`, and `conversion_factor`. Until populated, old PO meaning is incomplete.

GR `received_quantity` is source/commercial quantity. Phase 4 persists `source_uom`, `base_uom`, and `conversion_factor`; posting records `source_quantity` unchanged and multiplies it by the snapshotted factor before posting ledger quantity. Thus 2 CASE at factor 1000 posts 2000 EA. The transaction snapshot, never current master data, governs history.

Inventory `quantity`, balances, allocations, and reservations are always stock-item inventory UOM. `source_quantity`, `source_uom`, `base_uom`, and `conversion_factor` are immutable provenance snapshots. Packaging changes never rewrite them. A major package-size change is a replacement/revision Product even when MPN is unchanged; versioning is deferred.

## Category and manufacturer

`item_categories` and `item_manufacturers` remain identity authorities. Category has no deployed parent key, so no hierarchy is invented. Generic `subcategory` remains free-text and should eventually be controlled only after a dedicated model is approved. Manufacturer aliases aid lookup only; normalized name and `manufacturer_id` govern identity. Inactive references remain readable but cannot be newly assigned.

## Limitations

Migration/backfill need manual review. Existing PO rows lack snapshots; legacy `package_size`, `conversion_rules`, text UOM columns and `item_conversion` remain readable. Product revisioning and controlled subcategories are deferred.