# Inventory legacy write paths after Phase 3A compatibility pass

Repository-wide searches covered every SQL reference to `warehouse_stock_levels`, including
multiline inserts/updates and the exact legacy conflict target.

| Caller | Classification | Pair-key dependency and disposition |
|---|---|---|
| `inventoryPostingService` -> `InventoryRepository` | migrated to `inventoryPostingService` | Canonical ledger/projection writer. It uses an advisory lock, exact dimension lookup `FOR UPDATE`, then a plain insert; no pair upsert. |
| `procureToPayController.createGoodsReceipt` | migrated to `goodsReceiptInventoryAdapter` | Resolved receipt lines are posted once through the adapter with the existing transaction client. Unresolved identity warnings remain. The old balance upsert and duplicate `warehouse_stock_movements` insert were removed. |
| `InventoryRepository.setupWarehouse` / governed stock item creation | zero-level setup only (removed) | Configuration now upserts `warehouse_replenishment_policies`, including defaults. It creates no physical zero balance. A posting creates the untracked AVAILABLE identity only when real untracked stock arrives. |
| `warehouseTransfersController` destination upsert | legacy live stock writer; must migrate before removing old uniqueness | Still uses pair conflict and must remain disabled through/after SQL 004 until a transfer coordinator posts dimensioned dispatch/receipt. |
| `stockItemsController` initial allocations | legacy live stock writer; must migrate before removing old uniqueness | Pair upsert; endpoint must remain controlled. |
| `requests/updateRequestsController` receipt helper | legacy live stock writer; must migrate before removing old uniqueness | Pair upsert plus legacy movement; endpoint must remain controlled. |
| `warehouseInventoryController.addWarehouseStock` and `discardWarehouseStock` | legacy live stock writer; must migrate before removing old uniqueness | Direct dimension-aware lookup/insert/update, but not canonical ledger-backed; control endpoints pending migration. `issueWarehouseStock` is migrated. |
| `warehouseSupplyController` | legacy live stock writer; must migrate before removing old uniqueness | Direct batch-aware issue and legacy movement/supply writes; control endpoint pending migration. |
| `demandPlanningController` | read-only/unrelated | Its pair conflict targets `warehouse_replenishment_policies`, not balances; balance usage is read-only. |
| request creation, stock item list/detail, availability recalculation | read-only/unrelated | Reads/sums balances; recalculation writes only the compatibility cache on `stock_items`. Readers must aggregate all dimensions rather than assume one row. |
| maintenance/department stock and request flows not named above | read-only/unrelated to this pair constraint | They write department/custody/request relations or read warehouse balances; no pair-conflict balance insert was found. |
| `ensureWarehouseInventoryTables` | schema bootstrap | Historical six-column `batch_id` unique definition and ordinary pair index; it does not perform a live quantity write. |

## Deployment gate

SQL cannot detect JavaScript writers. Deploy this compatible application revision first, stop all
inventory writers, and keep the remaining legacy endpoints controlled. Do not remove pair-only
uniqueness while any pair-upsert endpoint can receive traffic. Only the goods-receipt path and the
canonical engine are approved live stock writers in this pass.

## Zero-level decision

Option A is adopted. `warehouse_replenishment_policies` already supplies the warehouse/item
configuration relation, so item setup always upserts a default or explicit policy and never creates
an artificial balance. Existing zero untracked AVAILABLE rows remain readable and are reported by
preflight when they coexist with tracked balances; they are not automatically deleted. Real
untracked stock may legitimately use that canonical all-null identity, while tracked batches occupy
separate canonical rows.