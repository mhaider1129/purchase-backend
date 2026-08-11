# Inventory legacy write paths — Phase 3B audit

| Endpoint/controller | Operation and old tables | Canonical target | Phase 3B disposition |
|---|---|---|---|
| `POST /warehouse-inventory/add` / `warehouseInventoryController` | Balance upsert plus legacy movement | `inventoryAdjustmentService.positive` | Migrated |
| `POST /warehouse-inventory/discard` / same | Balance decrement plus legacy movement | negative adjustment | Migrated |
| warehouse inventory issue | Issue | `inventoryPostingService` | Already migrated in 3A |
| `POST /warehouse-transfers/:id/approve` / `warehouseTransfersController` | Immediate source decrement/destination increment | dispatch coordinator; destination changes only on receipt | Migrated compatibility endpoint |
| `POST /warehouse-transfers/:id/receive` | none | traced transfer receipt | Added |
| warehouse supply fulfillment / `warehouseSupplyController` | Direct decrement and legacy movement | canonical ISSUE | Migrated; supply history remains business history |
| request receipt helper / `requests/updateRequestsController` | Direct upsert and legacy movement | `goodsReceiptInventoryAdapter` | Migrated |
| stock-item warehouse allocation / `stockItemsController` | Opening balance upsert | controlled positive adjustment/import | Migrated |
| `inventoryRepository` | Projection insert/update | canonical repository behind posting engine | Canonical, not a business endpoint |
| SQL snapshots/manual migrations | schema/history text | none | Historical or migration-only |
| tests | SQL assertions/mocks | none | Test-only |
| procurement plan consumption lookup | reads legacy movement | future reporting projection | Read-only, deferred |

No active business controller directly mutates `warehouse_stock_levels.quantity`. Reads of `warehouse_stock_movements` remain for compatibility reporting only.