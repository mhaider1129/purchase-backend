# Item master authority model (Phase 5A)

## Decision

The verified target remains **`generic_items` → `approved_products` → `supplier_catalog_items`**. This is not a new hierarchy: the migration, service validators, request identity service and stock mapping code already use it. The two older masters remain compatibility sources pending governed mapping.

| Level | Meaning | Identity and constraints | Authority |
|---|---|---|---|
| Generic Item | Manufacturer- and supplier-neutral functional requirement (for example, *IV Cannula 22G, sterile, safety type*). | `generic_items.id`; institutional `item_code`; controlled category/UOM FKs plus compatibility text; structured specification and fingerprint. | Planning, request and interchangeability identity. |
| Approved Product | Exact manufactured product satisfying one Generic Item (for example, *BD Insyte Autoguard 22G*, BD, MPN XXXXX). | `approved_products.id`; mandatory `generic_item_id`; canonical `manufacturer_id`; normalized MPN uniqueness; package/UOM and regulatory JSON. | Manufactured physical identity. |
| Supplier Catalog Item | A supplier-specific offer for one Approved Product (for example supplier ABC code ABC-5562, BOX). | `supplier_catalog_items.id`; mandatory `approved_product_id` and `supplier_id`; supplier-code uniqueness; purchasing UOM/conversion and commercial metadata. | Supplier/catalog identity, **not awarded-price authority**. |

The schema supports the conceptual separation and mandatory downward FKs. Gaps remain: duplicated text/FK category, manufacturer and UOM values; no controlled GTIN/UDI identifier rows; catalog purchasing UOM is text; and transactional propagation is incomplete.

## Authority rules

* `item_categories.id`, `item_manufacturers.id`, and `item_uom.id` are reference-master authorities. Their text counterparts are transitional display snapshots, not independent identity.
* Manufacturer Part Number identifies a manufactured product; supplier item code identifies a supplier offer; GTIN/UDI/barcode are external identifiers in `regulatory_identifiers`; `generic_items.item_code` is the internal functional-item code. These values are not interchangeable.
* `brand` is ambiguous in legacy/stock records. `item_brands` is a runtime-created legacy master associated with `item_master`; the normalized product hierarchy has no brand FK. A future controlled product brand/family may be justified, but must not model a manufacturer alias. Do not create it until values and use cases are profiled.
* Catalog `unit_price` is a **reference/list-price observation** unless it is explicitly tied to a governed contract line. It cannot override RFx response, procurement award, PO-line or contract-line price. `contract_id` alone does not prove line-level price authority.

## UOM model

Target: Generic inventory/base UOM → Approved Product package UOM and conversion to base → Supplier purchasing UOM and conversion to product/base. `item_uom` is the controlled vocabulary; `item_conversion`, JSON `conversion_rules`, product `inventory_conversion_factor`, catalog `conversion_factor`, and `uomConversionService` currently duplicate conversion facts. Consolidation must preserve effective dating, dimensional compatibility and exact-decimal calculation.

## Lifecycle and survivorship

Generic lifecycle is `draft → review → validation → approval → active → retired`; the service checks transitions and unresolved duplicate candidates before activation. Permissions are `item-master.create`, `.edit`, `.validate`, `.approve` (referenced but absent from the foundation migration), and `.retire`. Active rows remain mutable through future writers unless policy closes that boundary.

Product lifecycle is `draft/pending → approved/rejected → retired`. Creation requires an active Generic and approval has a dedicated permission, but no update/version endpoint exists in the foundation routes. Material identity changes (manufacturer, MPN, package or specification) should create a new product identity/version; historical approved identity must not be silently mutated.

Merge requests only record `generic_item_merges` and conflicts. There is no completed merge service. Future completion must retire/supersede the source, preserve aliases and mappings, redirect current references deliberately, and retain historical FK readability; it must never delete the duplicate.

## Healthcare inventory recommendation

Use a **hybrid model**: Generic Item for planning and substitutable procurement; Approved Product for physical traceability when batch, serial, expiry, recall, device or regulatory controls apply; `stock_items` for warehouse stocking identity. Allow a Generic-only stock item for genuinely interchangeable/non-regulated supplies and product-specific stock items for controlled products. The existing `(generic_item_id, approved_product_id, inventory_uom_id, institute)` duplicate check supports both. Multiple stock items per Generic are therefore valid only when product, UOM, institutional or stocking-policy identity differs; unexplained duplicates require stewardship.