# Stock Item write-path inventory

| Path | Function | Purpose / caller | Permission | Identity source | Quantity behavior | Classification | Validity and correction |
|---|---|---|---|---|---|---|---|
| `services/inventoryItemCreationService.js` | `create` | Add Item from Item Master API | `inventory.add-from-master` | Controlled Generic Item, Product, category, manufacturer and UOM | Creates only zero-level warehouse setup | normalized creation | Valid and authoritative. |
| `controllers/stockItemRequestsController.js` | approval branch in `updateStockItemRequestStatus` | Converts an approved free-text request | Existing stock request approver | Legacy request text | Creates identity only | legacy approved exception | Must be routed through an explicit `inventory.legacy-create` exception with reason before use; retained only for compatibility. |
| `utils/recalculateAvailableQuantity.js` | `recalculateAvailableQuantity` | Reconciles cached total after warehouse movements | Internal inventory workflows | Does not change identity | Updates aggregate `available_quantity` only | receipt-related behavior | Valid quantity maintenance; not a creation path. |
| `controllers/procureToPayController.js` and warehouse controllers | receipt/movement functions | Post receipts and warehouse movements | Existing receipt/inventory permissions | References existing Stock Item ID | Updates warehouse level and aggregate quantity | receipt-related behavior | Valid; must never create Stock Item identity. |
| Phase 1B import service | staging only | Steward spreadsheet migration | `item-master.stock-migration-maintain` | Source snapshot only | Never writes quantity | migration support | Database capability is not present; fail closed until contract objects exist. |

Repository-wide searches for `INSERT INTO stock_items`, `UPDATE stock_items`, `createStockItem`, `addStockItem`, and normalized identity columns identified no other application-code Stock Item insertion path. SQL artifacts are excluded because database changes are outside Phase 1B application scope.

## Effective duplicate key

The application duplicate key is `(generic_item_id, approved_product_id-or-null, inventory_uom_id, institute_id)`. Warehouse membership supplies institute scope. Ownership/consignment is not currently a controlled Stock Item field and therefore cannot safely distinguish duplicates; database requirement DBR-007 records the future contract. An equivalent row returns `409 inventory_item_exists` with the existing ID and match reason.