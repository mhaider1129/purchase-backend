# Phase 5A item writer and runtime-DDL boundaries

## Production writers

| Fact/table | Writer and route | Permission | Validation / transaction / audit / duplicate behavior | Finding |
|---|---|---|---|---|
| Generic | `itemMasterFoundationService.createGeneric`, transition, pending `new_generic_draft` | create; transition map uses edit/validate/**approve**/retire | Create is transactional, validates controlled refs, fingerprints, queues candidates and audits. Pending draft transaction also writes workflow. Activation blocks unresolved source candidates. | Canonical writer, but missing migrated `item-master.approve` permission and no general edit/version boundary. |
| Approved Product | foundation create/approve | products; products.approve | Requires active Generic, controlled manufacturer/UOM and unique normalized MPN. Create/approve are separate DB calls; create audits, approval does not write audit event. | Canonical but lifecycle/audit incomplete. |
| Supplier Catalog | foundation create/update/deactivate | suppliers | Requires approved active Product; validator uses JS Number; no explicit transaction/audit/duplicate beyond `(supplier, code)`. | Canonical commercial writer; precision and contract semantics need closure. |
| Pending/duplicate/merge | foundation service | map (submission accepts request/create permissions) | Resolution is transactional and can re-link request; duplicate decisions and merge proposal recorded. No merge completion. | Governance writer, incomplete survivorship. |
| Legacy mappings/aliases | foundation `mapLegacy` | legacy-maintain | Transaction, target validation, unique active mapping and audit. | Correct compatibility boundary. |
| `item_master_items` | `itemMasterController` create/update/submit/approve/reject/documents | Legacy routes have no route-level permission middleware (rely on global auth/controller checks) | Runtime ensure; direct SQL; workflow validation varies; no canonical fingerprint/mapping enforcement. | Active duplicate writer; freeze in 5A implementation. |
| `item_master` | runtime ensure only in searched production JS | None | No active create controller found. | Legacy schema, not a current application writer. |
| `stock_items` governed | `inventoryRepository.insertStockItem`; stock mapping apply | inventory.add-from-master / item-master.stock-map | Transaction orchestration, Generic/Product/UOM validation, duplicate check, mapping audit. | Canonical warehouse writer. |
| `stock_items` exception | `legacyStockItemRepository.insert` via legacy creation service | legacy compatibility middleware/path | Normalized-name lookup, `ON CONFLICT`, approved-exception source; no canonical identity. | Active escape hatch; high-priority restriction/mapping. |
| Reference masters | runtime ensure only; no normalized route writer identified | None | Database uniqueness only; manufacturer normalization migration. | Ownership gap: no governed canonical writer. |

No searched production writer deletes a canonical Generic or Product. Supplier “delete” is a soft deactivation.

## Runtime DDL

`utils/ensureItemMasterTables.js` is reachable from legacy Item Master controllers and creates `item_categories`, `item_uom`, `item_manufacturers`, `item_brands`, `item_master`, `item_variants`, `item_conversion`, `item_master_items`, documents, indexes and stock columns. It remains active after migrations 001–006 because routes call those controllers. `ensureItemRecallsTable`, `ensureRequestedItemUnitOfMeasureColumn`, requested-item schema ensures, `ensureMonthlyDispensingTables`, `ensureWarehouseSupplyTables`, and stock request repository ensures are item-adjacent and reachable. They are compatibility DDL, not authority.

The normalized hierarchy itself is migration-owned by `20260727_item_master_foundation.sql`; however that migration depends on runtime-created reference/legacy tables. Move reference and legacy schema to reviewed migrations before retiring ensures. Do not remove an ensure until startup/routes are proven against a migrated baseline.

## Financial precision inventory

Item-authoritative violations to correct later: catalog validator coerces `unit_price`, conversion factors, package size, MOQ, order multiple and lead time with `Number`; catalog service tests finiteness as Number; `uomConversionService` converts package price with `Number`; legacy controller numeric helper converts `standard_cost`, reorder and safety values; supplier controller numeric normalization may cover commercial values. Dashboard reporting also uses `parseFloat`; Phase 4 pricing/totals use `Number` in `procureToPayService`, `procurementPricingService`, RFx pricing and dashboards. These are enumerated rather than silently accepted: authoritative money should cross boundaries as decimal strings/minor units and use exact decimal arithmetic.