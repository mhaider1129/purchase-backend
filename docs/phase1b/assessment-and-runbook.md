# Phase 1B assessment and release runbook

## Repository and identity decision

The repository snapshot defines `stock_items.id` and every represented inventory reference as `INTEGER`. `generic_items` and `approved_products` use `BIGINT`; users and UOM use `INTEGER`. The existing `stock_items` row remains the inventory identity and operational quantity authority. Generic Item owns clinical/technical identity; Approved Product owns manufacturer configuration; Stock Item owns stocking configuration; transactions/batches own movement and lot facts. No spreadsheet was present in the repository, so the importer contract is header-alias based and the workbook must be profiled in staging before use.

The Phase 1A migration had already added a nullable `stock_items.generic_item_id`. Phase 1B only adds missing nullable links and governance metadata. It neither changes the primary key nor updates names, descriptions, quantities, or transaction references.

## Dependency map (repository snapshot)

| table | FK | referenced key | delete/update | purpose |
|---|---|---|---|---|
| warehouse_stock_levels | stock_item_id INTEGER | stock_items.id INTEGER | NO ACTION / NO ACTION | warehouse balance |
| warehouse_stock_movements | stock_item_id INTEGER nullable | stock_items.id | NO ACTION / NO ACTION | movement history |
| warehouse_item_batches | stock_item_id INTEGER | stock_items.id | NO ACTION / NO ACTION | lot, expiry, serial balance |
| department_stock_levels | stock_item_id INTEGER | stock_items.id | NO ACTION / NO ACTION | department balance |
| procurement_plan_items | stock_item_id INTEGER nullable | stock_items.id | NO ACTION / NO ACTION | demand plan |
| warehouse_replenishment_policies/tasks | stock_item_id INTEGER | stock_items.id | NO ACTION / NO ACTION | replenishment |
| inventory_transactions | stock_item_id INTEGER | stock_items.id | NO ACTION / NO ACTION | immutable inventory ledger |
| warehouse_transfer_items | stock_item_id INTEGER | stock_items.id | NO ACTION / NO ACTION | transfer lines |
| item_recalls (runtime DDL) | item_id INTEGER nullable | stock_items.id | SET NULL / NO ACTION | recall compatibility |

Goods receipt and purchase-order lines currently carry normalized Generic/Product/Catalog links rather than a declared Stock Item FK in the represented schema. Returns/reservations have no dedicated Stock Item FK in this snapshot and require production-catalog verification before release.

## Legacy name paths

Standalone creation/name matching remains in `stockItemRequestsController` (approval inserts a row), `warehouseSupplyController`, request update/create flows, recall fallback, and Goods Receipt handling in `procureToPayController`. Phase 1B adds the enforced `/stock-items/add-from-master` route. The legacy request approval path must be feature-disabled for ordinary users at deployment and retained only behind `inventory.legacy-create`; name fallbacks must be instrumented in a follow-up before the gate can pass.

## Import specification

Required semantic headers are Stock Item ID and Item Name; optional aliases cover Brand/Manufacturer, Category, Subcategory, UOM/Unit, Description, Quantity and Cost. Resolve by normalized header text, never position. Parse IDs as positive integers; reject duplicate IDs within a batch and invalid numeric snapshots. Canonicalize source fields, compute SHA-256 over sorted semantic keys, and insert `(source_stock_item_id, source_checksum)` with conflict/no-op. A changed checksum appends a new staging version; absent later rows are retained. Staging never writes live stock, quantities, transactions, or Item Master activation.

## Display and lot architecture

Use `stock_item_identity_read_model`: normalized identity when linked and the preserved legacy name otherwise. New rows capture the selected hierarchy in the snapshot; historical names are never overwritten. Existing batches, expiries, serials and balances stay in their current tables. A later separately rehearsed design should treat current Stock Item as `inventory_items`, `warehouse_item_batches` as the lot foundation, warehouse/department stock levels as balances, and `inventory_transactions` as the ledger. Do not move balances or lots in Phase 1B.

## Deployment gates and manual steps

1. Freeze application schema-writing jobs; use a non-production clone and read-only credentials for preflight.
2. Run `psql -v ON_ERROR_STOP=1 -f sql/verification/phase1b_pre_migration.sql`, sign and archive counts/ID and quantity checksums.
3. Apply Phase 1A if absent, then Phase 1B files 01–05 in order with a migration role. Never use `supabase db push` against production.
4. On a representative staging database, exercise mapping conflicts, rollback, RLS, historical lookup, and add-from-master. Run the post script with baseline variables.
5. Run complete backend/frontend tests, lint and production build. Manually verify steward mapping and inventory creation.
6. Only after reconciliation and approval, repeat through the controlled production change process. This repository work performs no production action.

## Rollback

**Application:** disable new routes and deploy the old build; preserved legacy columns remain readable. **Mapping:** in one transaction lock Stock Item and active mapping, mark mapping `rolled_back`/inactive, restore nullable prior identity from `previous_identity`, and append an audit event; never delete history or alter quantity. **Schema:** first remove all new write paths. Retain tables, columns, snapshots and audit history. Do not drop columns while any build reads them. A destructive rollback is a backup-restoration governance decision, not a down migration.

## Outstanding risks and technical debt

No workbook was supplied; production catalog introspection and staging application were not performed. Runtime DDL means repository SQL may not equal production. Some name matching and standalone approval creation remain and prevent claiming completion/production readiness. The steward dashboard and bulk review UI, import upload endpoint, full concurrency/integration tests, role-to-permission assignments, explicit backend-only RLS service-role policies, and fallback audit instrumentation remain. Concurrent indexes should be evaluated from production table size and, if needed, created in isolated non-transactional `CREATE INDEX CONCURRENTLY` operations. Phase 1B is not production-ready until every documented gate passes.