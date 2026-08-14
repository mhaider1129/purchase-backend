# Phase 5A.1 deployed schema contract

This contract is derived from `View_Supabase_SQL.sql`, the 2026-07-27 migration, and current production queries. Snapshot names are not aliases for canonical foreign keys.

| Table | PK | Name/code | Status | Normalization | Foreign keys | Approved writer / readers |
|---|---|---|---|---|---|---|
| `item_categories` | `id` | `category_name` | `is_active` | `normalized_name` (008 additive baseline) | `created_by`, `updated_by` → `users.id` (008) | Foundation service reference methods / foundation service and legacy compatibility reads |
| `item_manufacturers` | `id` | `manufacturer_name` | `is_active` | `normalized_name` | `created_by`, `updated_by` → `users.id` | Foundation service reference methods / product and reference reads |
| `item_uom` | `id` | `uom_code`, `uom_name` | `is_active` (008 additive baseline) | `normalized_uom_code` (derived from code only) | `created_by`, `updated_by` → `users.id` (008) | Foundation service reference methods / generic, product, inventory readers |
| `generic_items` | `id` | `item_code`, `generic_name` | `lifecycle_status`, `is_active` | `structured_fingerprint` | `category_id`; `base_uom_id`, `inventory_uom_id`, `purchasing_uom_id`; actor FKs | `itemMasterFoundationService` / hierarchy, procurement identity and reporting readers |
| `approved_products` | `id` | `product_identifier`, `product_name`, `manufacturer_part_number` | `approval_status`, `is_active` | `normalized_manufacturer_part_number` | `generic_item_id`, `manufacturer_id`, **`product_uom_id`**, actor FKs | `itemMasterFoundationService` / hierarchy and procurement identity readers |
| `supplier_catalog_items` | `id` | `supplier_item_code` | `is_active`, availability/approval flags | uniqueness on `(supplier_id, supplier_item_code)` | `supplier_id`, `approved_product_id`, `contract_id`, actor FKs | `itemMasterFoundationService` / hierarchy, PO and receipt readers |

## Corrected query mismatch

The legacy repository joined product UOM through nonexistent `approved_products.uom_id`. Runtime SQL now uses the deployed `approved_products.product_uom_id`. Reference queries use `category_name`, `manufacturer_name`, `uom_code`, and `uom_name`; compatibility `name`/`code` values are output labels only.

## Writer boundary

Canonical DML is confined to `services/itemMasterFoundationService.js` plus its migration definitions. Controllers enforce permissions and delegate; they are not canonical SQL writers. Legacy `item_master_items` remains readable, while identity creation and identity-changing workflow operations require `item-master.legacy-maintain`.

## Governed compatibility boundaries

The temporary Stock Item compatibility exception remains unchanged: it requires `stock-requests.review`, `inventory.legacy-create`, an explicit legacy creation reason, and audit evidence. Legacy `item_master_items` maintenance is restricted to `item-master.legacy-maintain`. The direct-SQL scanner cannot discover interpolated statements such as `INSERT INTO ${table}`; the authority test therefore separately asserts that canonical reference mutation routes delegate only to `ItemMasterFoundationService`.