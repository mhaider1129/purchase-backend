# Inventory legacy write paths after Phase 3 foundation

| Writer | Status | Why / next action |
|---|---|---|
| `inventoryPostingService` -> `inventoryRepository` | valid projection maintenance | Only canonical writer for migrated operations; locked and ledger-backed. |
| `warehouseInventoryController.issueWarehouseStock` | migrated | No direct balance SQL remains in the issue function. |
| `warehouseInventoryController.addWarehouseStock`, `discardWarehouseStock` | must migrate Phase 3B | Direct receipt/adjustment projection writes. |
| `procureToPayController` accepted receipt block | unsafe / must migrate Phase 3B | Direct upsert remains; switch to `goodsReceiptInventoryAdapter` only after SQL 004 rollout and receipt identity mapping validation. |
| `warehouseTransfersController.approveTransfer` | unsafe / must migrate Phase 3B | Instant destination increment contradicts in-transit lifecycle. |
| `warehouseSupplyController` | must migrate Phase 3B | Duplicate issue implementation. |
| `stockItemsController` initial allocation | must migrate Phase 3B | Direct positive adjustment without canonical ledger/idempotency. |
| `requests/updateRequestsController` receipt helper | unsafe / must migrate Phase 3B | Duplicate receipt posting. |
| `inventoryRepository.setupWarehouse` | valid projection maintenance | Creates only zero quantity during governed item setup. |
| `recalculateAvailableQuantity` | valid projection maintenance | Compatibility cache, never the authoritative warehouse balance. |
| SQL/schema fixtures and tests | test-only / historical | Definitions and mocks, not runtime writers. |

Runtime direct writers outside the engine after this phase: **six controller flow groups**. Canonical engine projection writers: **one repository**. Valid initialization/cache writers: **two**. Search command is recorded in the completion report and should be rerun after each migration.