# Phase 5A name/code identity debt

| Location | Current behavior | Classification | Priority/remediation |
|---|---|---|---|
| `legacyStockItemRepository.findByNormalizedName` | Normalized stock name selects an existing operational stock ID. | **IDENTITY RESOLUTION** | Critical: exception bridge only; replace with governed mapping/idempotency key. |
| `warehouseSupplyController` | `(item_id = ? OR LOWER(item_name)=LOWER(?))` selects supply record. | **IDENTITY RESOLUTION** | High: require stock/request identity; keep name only for display. |
| `createRequestController` | Builds normalized `TRIM(LOWER(item_name))` map and resolves stock items. | **IDENTITY RESOLUTION / LEGACY COMPATIBILITY** | High: route through Generic/stock mapping. |
| `procureToPayController` | Joins requested and warehouse supply lines by lowered name. | **IDENTITY RESOLUTION** | High: persist request/stock IDs. |
| `procurement/plansController` | Joins plan and monthly dispensing by lowered item name. | **IDENTITY RESOLUTION** | High for planning accuracy: map dispensing facts to Generic. |
| `itemMasterFoundationService.mapLegacy` | `LOWER(TRIM(name))` creates an alias only after an explicit steward mapping. | **LEGACY COMPATIBILITY** | Acceptable; alias must never self-approve a mapping. |
| Foundation searches, legacy Item Master search, request/history filters, contract search, technical inspection search | `ILIKE`/`LOWER` finds rows for humans. | **SEARCH ONLY** | Retain; return stable IDs and label results as legacy where applicable. |
| RFx description `COALESCE(TRIM(specs/intended_use/brand))` and transaction `item_name` fields | Produces immutable presentation text. | **DISPLAY / TRANSACTION SNAPSHOT** | Retain alongside IDs. |
| `warehouse_stock_levels.item_name`, recalls and templates | Human-readable snapshots, with some legacy flows. | **DISPLAY / LEGACY COMPATIBILITY** | Stop using snapshot as join key; preserve history. |
| Contract `item_name/generic_name/brand_name` | Free-text contract line selection and update. | **IDENTITY RESOLUTION BY USER ENTRY** | High: add governed Generic/Product/Catalog references without rebuilding contracts. |

Name, description, supplier description and codes are valid search keys but not referential identity. Every high-priority path needs an explicit legacy mapping or FK and must preserve the original text as a snapshot.