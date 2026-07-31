# Phase 1B implementation verification

## Commit verification

| File | Function/component | Claimed behavior | Actual behavior and defect found | Correction | Coverage |
|---|---|---|---|---|---|
| `validators/stockItemIdentityValidator.js` | `validateAddToInventoryPayload` | Enforce normalized payload | Correct controlled IDs/zero quantity; did not reject all ownership text | Consignment is explicitly rejected; warehouse uniqueness and policy bounds retained | `stockItemIdentityMiddleware`, `phase1bCompletion` |
| `repositories/itemMasterRepository.js` | controlled lookups | Category, UOM, manufacturer and Product ownership | Generic query joins category; UOM is active; Product joins manufacturer/UOM. Product UOM is loaded but intentionally not used as Inventory UOM | Service now fails when category/manufacturer reference is absent and checks Product ownership | service transaction tests remain required against the manually staged contract |
| `repositories/inventoryRepository.js` | duplicate/setup/policy | Scoped duplicate and zero setup | Duplicate scope existed only through existing warehouse rows, leaving concurrent inserts and unassigned items ambiguous | Limitation is documented; application transaction locks matching rows, while a database uniqueness contract remains necessary for cross-process concurrency | validation and repository query review |
| `services/inventoryItemCreationService.js` | `create` | Atomic normalized creation | BEGIN/COMMIT/ROLLBACK was correct; capability was not checked before transaction | Foundation and identity capabilities now fail closed before opening a write transaction | `phase1bCompletion` capability tests |
| `repositories/stockItemMappingRepository.js` | mapping persistence | Optimistic immutable transitions | Prior implementation could approve without deactivating an active mapping and had no administration reads | Added paginated reads, coverage, proposals, versioned transitions, and active approval deactivation | `phase1bCompletion` transition/pagination tests |
| `services/stockItemMappingService.js` | transition/supersede/rollback | Formal state machine | Prior supersede/rollback merely ended the current row and ignored replacement/restore IDs | Replacement/restore is locked, validated, activated, applied, audited, and committed atomically | transition tests; DB integration remains contract-dependent |
| `controllers/stockItemIdentityController.js` | thin HTTP adapter | Identity and override actions | Only add/supersede/rollback existed | Added list, history, detail, proposal, review, approve, reject, terminal classification, and coverage adapters | route/static tests |
| `routes/stockItems.js` | authorization | Central permissions | Add and override permissions were correct; administration routes were absent | Added centralized `item-master.stock-map` protection to administration routes | middleware tests |
| `services/databaseCapabilityService.js` | detection/cache | Safe short cache | Correct fail-closed object lookup and 30-second default; not used by normalized creation | Creation now requires server-derived capabilities before any write | `phase1bCompletion` partial/failure/cache tests |
| `services/stockItemIdentityService.js` | normalization/scoring facade | Readable composition and hard conflicts | Candidate helpers remain general-purpose; hard conflicts correctly force score zero | Separate category parsers added; no automatic approval exists | identity and parser tests |
| `docs/phase1b/database-contract-requirements.md` | contracts | Non-executable DB requirements | Descriptive only | Expanded verification and inventory-semantics documents | documentation review |
| SQL files in the commit | artifact rollback | Leave unrelated prior SQL changes untouched | The commit changed SQL by reverting earlier edits; no new SQL was generated | No SQL file is changed by this completion work | `git diff HEAD -- purchase-backend/sql` |

## Transaction and error verification

Normalized creation validates capabilities before connecting, begins once, performs every lookup/write on the same client, commits once, and rolls back every thrown warehouse, policy, audit, or validation failure. Mapping approval and overrides similarly lock rows and keep the mapping decision, live identity, and audit event in one transaction. Stable errors are returned through the existing global handler; no SQL or schema details are included.

## Parent-versus-current regression proof

The five previously failing suites were executed at current HEAD and in a detached worktree at the immediate parent. Both produced exactly **5 failed suites, 11 failed tests, 18 passed tests** for the comparison set. The same fully-qualified test names failed in both:

- `__tests__/createRequest.test.js`: active maintenance requester; temporary requester attachment/log actor.
- `tests/app.test.js`: API-prefix auth route; root protected aliases; double-API normalization.
- `tests/warehouseInventoryController.test.js`: single-item and multi-item warehouse issue commits.
- `tests/authMiddleware.test.js`: active user pass-through; role fallback; unexpected-error fallback.
- `__tests__/authMiddleware.test.js`: inactive-user rejection.

The failures are cause-equivalent because the immediate parent has identical failing test names and counts and none of the Phase 1B commit files are imported by those failing unit paths except the global route module, whose failures also occur before the commit. These are baseline defects, not Phase 1B regressions.

## Warehouse stock-level semantics

`warehouse_stock_levels` is the application's aggregate `(warehouse_id, stock_item_id)` balance and assignment record. Receipts, transfers, initial allocation, issues, and adjustments upsert or mutate that aggregate row. `recalculateAvailableQuantity` sums these aggregate rows into the compatibility cache `stock_items.available_quantity`. `warehouse_item_batches` stores batch/lot/expiry/serial detail separately; movement code changes the aggregate level as well as batch detail. Therefore summing both tables would double count.

Add Item from Item Master should create exactly one zero-quantity aggregate row per selected warehouse and no batch row. This matches the existing assignment path, makes the item selectable before receipt, and does not affect the summed balance. A receipt owns later batch creation and quantity movement.

## Duplicate scope decision

- Warehouses in one institute share one normalized identity; a match in any warehouse blocks another Stock Item.
- Warehouses across institutes may use separate Stock Item records under the current application contract.
- An unassigned item has no derivable institute scope; it is allowed only as a controlled limitation and cannot be safely deduplicated until assignment.
- Generic-only (`approved_product_id IS NULL`) and Product-specific identities are distinct. Null Products compare null-safely.
- Later assignment must repeat the institute duplicate check before adding the level.
- Consignment/supplier ownership cannot be represented by the confirmed contract and is rejected as caller identity rather than used to evade duplicate checks.
- Row locks reduce races against existing identities, but definitive concurrent insert prevention requires the non-executable uniqueness contract documented in DBR-008.