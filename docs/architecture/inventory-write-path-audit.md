# Inventory write-path audit

Repository-wide `rg` searches covered balance/ledger terms, receipt, issue, transfer, return, recall, quarantine, maintenance, custody, dispensing, request, batch/lot/serial/expiry, schema/SQL, scheduled utilities, reports/dashboards, and frontend warehouse APIs. `inventory_transactions` and `warehouse_stock_levels` are the viable canonical ledger/projection.

Legend: Tx/Lock/Neg/UOM/ID/Track/Audit/Rev/Scope are transaction, row lock, negative prevention, UOM normalization, governed identity, tracking, central audit, reversal, and institute/warehouse scope.

| File / function / endpoint | Operation and writes | Tx/Lock/Neg/UOM/ID/Track/Audit/Rev/Scope | Classification / migration |
|---|---|---|---|
| `controllers/warehouseInventoryController.issueWarehouseStock` `POST /warehouse-inventory/issue` | Department issue; engine writes `warehouse_stock_levels`, `inventory_transactions`, audit | Y/Y/Y/retained/Y/Y/Y/Y/Y | **canonical candidate; migrated** |
| same / `addWarehouseStock` | manual receipt; levels, warehouse movements, ledger, cache | Y/Y/N/N/name/Y/N/N/warehouse-only | **legacy/unsafe; 3B** |
| same / `discardWarehouseStock` | outbound adjustment; same tables | Y/Y/partial/N/name/Y/N/N/warehouse-only | **legacy; 3B** |
| `procureToPayController.createGoodsReceipt` | accepted receipt directly upserts level and movement | Y/N/N/N/fallback-name/N/N/N/partial | **duplicate/unsafe**; adapter created, legacy call retained pending schema rollout |
| `warehouseTransfersController.approveTransfer` | immediate source decrement + destination increment; paired movements | Y/source only/Y/N/name/N/N/N/warehouse-only | **contradictory; 3B** |
| `warehouseSupplyController.issueSupply` | supply issue decrements level, writes movement/cache | Y/Y/partial/N/name/N/N/partial | **duplicate/legacy; 3B** |
| `stockItemsController.allocateStockItem` | initial allocation upsert + movement/cache | Y/N/N/N/item/Y/N/N/partial | **legacy/unsafe; 3B** |
| `requests/updateRequestsController` receipt helper | receipt/allocation upsert + movement | Y/N/N/N/name/N/N/N/partial | **duplicate/unsafe; 3B** |
| `utils/recalculateAvailableQuantity` | derives and updates `stock_items.available_quantity` | joins caller/no/N/A/N/A/N/A/N/A | **historical compatibility projection** |
| `repositories/inventoryRepository.setupWarehouse` | creates a zero projection row during governed item creation | Y/N/N/A/Y/N/item-master audit/N/Y | **valid projection initialization** |
| `itemRecallsController` | recall records/status only; does not change quantity projection | varies/N/N/A/item/references/N/N/partial | **disconnected control; migrate status blocking 3B** |
| custody, dispensing, maintenance stock, stock requests | business/custody/request records; no direct warehouse balance SQL found | varies | **historical/read-only or disconnected upstream** |
| reports, dashboards, scheduled jobs, frontend calls | read/derive or call above endpoints | N/A | **historical/read-only** |

## Every direct balance update/insert

| Location | Direct statement | Disposition |
|---|---|---|
| `warehouseInventoryController` issue | removed; now service/repository | migrated |
| `warehouseInventoryController` add/discard | insert/update `warehouse_stock_levels` | 3B |
| `procureToPayController` | receipt upsert | 3B after adapter rollout |
| `warehouseTransfersController` | source update/destination insert | 3B |
| `warehouseSupplyController` | decrement | 3B |
| `stockItemsController` | allocation insert | 3B |
| `requests/updateRequestsController` | receipt insert | 3B |
| `inventoryRepository.setupWarehouse` | zero-row insert | valid initialization |
| `inventoryRepository` engine methods | locked projection maintenance | canonical |
| `recalculateAvailableQuantity` | cache update only | valid derived projection |

No direct warehouse balance SQL was found in custody, maintenance, dispensing, stock-request, recall, reports, dashboards, or scheduled jobs; those modules can still initiate or constrain future stock behavior and must use the engine when connected.