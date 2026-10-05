# Supabase backend contract audit

Audited against `origin/master` at `e2053f01` on 2026-10-05. This replaces the earlier lineage-only review: the comparison includes current controllers, routes, repositories, services, middleware, startup DDL helpers, capability checks, maintained SQL, and frontend UI resource consumers. No Supabase connection or SQL execution was performed.

## Findings and limits

| Input | Supplied baseline | Gaps in this snapshot |
| --- | --- | --- |
| `sql/View_Supabase_SQL.sql` | 100 tables; 1,337 columns | 124 module/supporting table definitions and 14 existing-table columns |
| `sql/permissions_Table.sql` | 140 permission codes | Six approval-authority capability definitions |
| `sql/UI_resource_permissions.sql` | 36 UI resource keys | None; all 28 backend defaults and 32 concrete frontend resource keys are covered |

**Absent from the export does not prove absent from the live database.** The schema export is internally incomplete: it contains foreign keys to `approved_products`, `assets`, `generic_items`, `notification_outbox`, `procurement_awards`, and `supplier_catalog_items`, without their table definitions. It also does not export index, function, trigger, sequence, view, RLS-policy, or grant definitions. Run the read-only verification SQL before deciding which gaps actually need repair.

The context export cannot be executed directly. Two array types are shown as generic `ARRAY`; two conversion-factor checks end with truncated `NOT VALI)` text; FK targets and creation order are incomplete. The UI export also includes untyped `ARRAY[]`. Only the disposable test fixture normalizes these export artifacts. Original snapshots remain unchanged.

Static extraction inspected 16,758 string literals, including 2,417 SQL literals. The reconciled inventory contains 224 tables and 3,147 required column names plus two optional result metadata fields, retaining the 100 baseline tables and merging current maintained definitions with active query requirements. Dynamic SQL and data-dependent workflows require additional application testing; query planning does not execute a business operation.

Three deferred SQL-only foundations (`item_attribute_templates`, `stock_item_attribute_suggestions`, `item_uom_conversions`) are excluded from the runtime patch. The first two have no active backend consumer; migration 009 explicitly describes the third as a deferred foundation rather than runtime conversion authority. Number-allocator tables are included because deployed numbering functions require them. `stock_item_migration_staging` is included because `databaseCapabilityService` requires it for stock import readiness.

## Manual application

**MANUAL DATABASE MIGRATION REQUIRED** for confirmed gaps.

1. In the development Supabase SQL Editor, run `sql/manual/035_backend_schema_reconciliation_verify.sql`. It is read-only and works before missing module relations exist. Save its single report table.
2. During a write maintenance window, paste and run the **complete** `sql/manual/035_backend_schema_reconciliation.sql` as database owner. PostgreSQL 15+ and `btree_gist` are required. Do not run the context export or blindly replay all historical migrations.
3. Run `sql/manual/036_permission_catalog_reconciliation.sql` to add the six missing definitions. It preserves all existing catalog rows and role/user grants and repairs both owned and default-referenced permission sequences without lowering their values.
4. `sql/manual/037_ui_resource_reconciliation.sql` is **optional**. No keys are missing from the supplied UI snapshot. It inserts missing backend defaults only and never overwrites custom permissions, labels, descriptions, or `require_all` choices.
5. Rerun the verification SQL. All `missing_or_invalid` counts should be zero. Informational outputs for unvalidated constraints, column declarations, inventory indexes, and authority grants require review; zero missing-object counts alone do not prove semantic compatibility.
6. Assign new authority capabilities explicitly to appropriate roles through Management. The policy resolver joins users to their role by name and filters users by institute. A direct user grant alone does not satisfy that resolver. Adding catalog codes does not enable policy live routing or change historical approvals.

If the patch stops, keep the error and reconcile the specific live data/schema conflict. Do not bypass the check, delete historical records, or substitute guessed identifiers. Test on development first before separately scheduling production use.

## Preservation and compatibility behavior

The schema patch creates missing relations and adds missing columns; it does not drop populated tables, replace legacy master data, activate drafts, infer item mappings, fabricate acceptance evidence, backfill institute ownership, or change accounting/approval history. New `generic_items` remain draft/inactive. Existing Management `enforce_item_identity` choices are retained; a completely absent policy starts with strict enforcement.

Foreign keys and checks added to existing relations use `NOT VALID` where supported: they enforce new writes while preserving old rows for explicit reconciliation and later validation. Unique/exclusion indexes still validate existing data immediately and can stop the transaction. A preflight stops populated partial module installations when a missing column requires NOT NULL, a primary key or a default, so those historical values cannot be inferred by ADD COLUMN. Nullable additions without defaults remain additive. These are deliberate stops rather than guessed historical values.

The patch installs missing canonical indexes, functions, triggers, views, and the PO-number sequence. Existing object bodies are preserved rather than overwritten. **Same-name type, default, constraint, index, function, trigger or view drift needs individual review.** This patch is structural reconciliation, not a substitute for historical cutover/backfill gates from migrations 004–034. Existing rows may still need controlled unit mappings, normalized item references, organization assignments, asset/equipment reconciliation, contract coverage, and finance linkage.

The one removal is the inventory engine's reviewed compatibility correction: after installing canonical seven-column stock identity uniqueness, remove only exact non-expression, non-partial pair or six-column historical warehouse-balance unique keys. `batch_id` and all rows remain. Unrelated unique objects remain. The canonical identity includes stock status and NULLS NOT DISTINCT so AVAILABLE and QUARANTINE balances can coexist without duplicate balances in the same status. Dependent objects or duplicate canonical identities stop the transaction for explicit review.

Module-table RLS is enabled; no permissive browser-write policies or grants are added. Missing reporting views are installed with `security_invoker=true` so a view cannot bypass underlying table RLS. Existing policies/views remain unchanged. The application database role must retain the owner/service access expected by the existing backend. This patch does not silently grant browser access.

Sequence advances never lower existing values. PostgreSQL sequence `setval` effects are nontransactional: a later failure may leave a harmless upward advance, while ordinary DDL/data changes roll back. Sequence gaps do not indicate lost business records.

Reference tables already exist in the snapshot (`item_categories`, `item_uom`, `item_manufacturers`), but it does not show their rows. Empty dropdowns can therefore reflect missing/inactive reference **data** or missing role authorization. No category/UOM/manufacturer rows or authority users are invented. `item-master.references-maintain` already exists in the supplied permission catalog; confirm the intended steward's effective grants separately.

## Existing evaluation results without timestamps (2026-10-06)

If SQL 035 reports `Populated partial module procurement_evaluation_results.created_at`, run the complete `sql/manual/038_evaluation_result_timestamp_compatibility.sql` and then retry the original SQL 035. Alternatively, run the corrected SQL 035, which includes the same repair.

The backend's result persistence INSERT and `ensureResultPersistenceSchema` do not require `created_at` or `updated_at`. The original reconciliation was too strict for these optional metadata fields. SQL 038 adds only missing columns as nullable timestamptz **without an initial default**, then sets defaults separately for future inserts. Existing timestamps, custom defaults, result amounts, scores, ranking and compliance values are preserved. Missing historical timestamps remain NULL; no date is copied from a parent case or fabricated from the migration time. An insert default for `updated_at` is not an automatic update trigger.

Only these two result metadata fields are exempted from the populated-partial-module preflight. Missing financial, compliance, identity, approval and other required/defaulted fields still stop for explicit reconciliation. Existing type or NOT NULL drift is not altered.

The procurement-evaluation Jest suite passed all 17 tests for this correction. Regression coverage includes a populated results table lacking both timestamps, repair through corrected SQL 035 and standalone SQL 038, repeated application, unchanged historical JSON row values, preserved existing timestamps/defaults and non-NULL defaults on new results.

## Existing-table column gaps

| Relation | Missing columns |
| --- | --- |
| `ap_vouchers` | `contract_id` |
| `approval_route_rules` | `approver_id` |
| `commitment_ledger` | `journal_entry_id` |
| `contract_evaluations` | `total_score` |
| `gl_postings` | `journal_entry_id` |
| `item_uom` | `name` |
| `purchase_orders` | `contract_id` |
| `stock_items` | `category_id`, `manufacturer_id`, `institute_id` |
| `supplier_invoices` | `contract_id` |
| `suppliers` | `institute_id` |
| `users` | `updated_at` |
| `warehouses` | `is_active` |

The nullable `institute_id` fields on stock, suppliers, Generic Items and Approved Products satisfy queries in `fixedAssetService.validateLinks`, but existing records must receive verified scope before that service can link them. Do not assign every supplier or item to an arbitrary institute; review the global-versus-scoped master-data design.

`contract_evaluations.total_score` is required by the governance dashboard, while the existing writer saves JSON criteria and does not calculate it. The patch creates a nullable column without inventing scores; the dashboard still needs a defined scoring calculation/backfill.

`item_uom.name` is a generated alias of `uom_name` for the inventory repository's existing read. It stays synchronized when the controlled UOM name changes.

New module definitions also include missing procurement package/overage metadata and the complete procurement-evaluation case, offer, test, cost, criterion, score and result fields used by dynamic backend writes.

## Permission definitions missing

- `approval-authority.ceo`
- `approval-authority.cfo`
- `approval-authority.coo`
- `approval-authority.medical-devices`
- `approval-authority.supply-chain`
- `approval-authority.warehouse`

Evidence: `services/approvalPolicyEngine.js:5` defines these aliases; `services/approvalPolicyShadowService.js:3` resolves them through `roles`, `role_permissions` and `permissions`. The catalog comparison covers 111 legitimate backend permission references/definitions, including generated core definitions. Extra existing permissions are retained.

## UI resource coverage

No missing resource key was found. Strings such as `feature.nav`, `feature.path`, `feature.resourceKey`, `feature.requiredPermissions`, and `feature.requireAllPermissions` are JavaScript property references rather than concrete resource IDs. They are deliberately excluded. Existing empty permission arrays for Item Master, demand planning and approval history are retained; backend endpoints continue to require their own permissions.

## Missing table definitions and provenance

This list describes the supplied snapshot, not confirmed live absence. Tables derived from queries where no CREATE definition exists are spelled out in the patch, rather than silently relying on startup creation. Procurement evaluation derives from `routes/procurementEvaluations.js` and `services/procurementEvaluationService.js`; notification outbox derives from both outbox services; section assignments derive from the create-request controller.

| Relation absent from snapshot | Definition source |
| --- | --- |
| `ai_interactions` | `sql/manual/033_ai_intelligence_foundation.sql` |
| `ai_tool_executions` | `sql/manual/033_ai_intelligence_foundation.sql` |
| `approval_authority_delegations` | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approval_policies` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rule_conditions` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rule_steps` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rules` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_differences` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_runs` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_steps` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_versions` | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_route_snapshot_steps` | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approval_route_snapshots` | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approved_products` | `sql/migrations/20260727_item_master_foundation.sql` |
| `approved_spare_parts` | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `asset_categories` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_exceptions` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_inventory_discoveries` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_expected_assets` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_findings` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_number_allocators` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_observations` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_resolutions` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_sessions` | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_locations` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_movements` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_number_allocators` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_tags` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `assets` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `contract_ai_extractions` | `controllers/contractsController.js:3743` |
| `contract_alerts` | `controllers/contractsController.js:995` |
| `contract_amendments` | `controllers/contractsController.js:981` |
| `contract_approvals` | `controllers/contractsController.js:1007` |
| `contract_clause_assignments` | `controllers/contractGovernanceController.js:63` |
| `contract_clauses` | `controllers/contractGovernanceController.js:50` |
| `contract_consumption` | `controllers/contractsController.js:3797` |
| `contract_document_versions` | `controllers/contractsController.js:1123` |
| `contract_documents` | `controllers/contractsController.js:1109` |
| `contract_equipment_coverage` | `sql/manual/021_contract_equipment_coverage.sql` |
| `contract_invoices` | `controllers/contractsController.js:3774` |
| `contract_items` | `controllers/contractsController.js:1034` |
| `contract_legal_reviews` | `controllers/contractGovernanceController.js:116` |
| `contract_logs` | `controllers/contractsController.js:1077` |
| `contract_negotiations` | `controllers/contractGovernanceController.js:102` |
| `contract_obligations` | `controllers/contractsController.js:1170` |
| `contract_payments` | `controllers/contractsController.js:3791` |
| `contract_renewal_events` | `controllers/contractsController.js:1181` |
| `contract_required_documents` | `controllers/contractsController.js:1064` |
| `contract_risk_assessments` | `controllers/contractsController.js:3742` |
| `contract_sla_events` | `controllers/contractGovernanceController.js:89` |
| `contract_templates` | `controllers/contractGovernanceController.js:35` |
| `contract_versions` | `controllers/contractGovernanceController.js:142` |
| `department_item_follow_up_notes` | `utils/ensureDepartmentItemFollowUpNotesTable.js:8` |
| `department_priority_rankings` | `sql/manual/012_procurement_priority_foundation.sql` |
| `document_branding_settings` | `sql/migrations/20260929_document_branding.sql` |
| `employee_tasks` | `sql/development/20261005_02_employee_tasks.sql` |
| `generic_item_merges` | `sql/migrations/20260727_item_master_foundation.sql` |
| `generic_items` | `sql/migrations/20260727_item_master_foundation.sql` |
| `inventory_cycle_count_lines` | `sql/manual/005_inventory_operations.sql` |
| `inventory_cycle_counts` | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservation_allocations` | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservation_issue_operations` | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservations` | `sql/manual/005_inventory_operations.sql` |
| `inventory_transaction_allocations` | `sql/manual/004_inventory_transaction_engine.sql` |
| `inventory_transfer_allocation_links` | `sql/manual/005_inventory_operations.sql` |
| `inventory_transfer_movement_links` | `sql/manual/005_inventory_operations.sql` |
| `inventory_transfer_receipt_operations` | `sql/manual/005_inventory_operations.sql` |
| `invoice_match_override_decisions` | `sql/manual/006_connected_procure_to_pay.sql` |
| `item_duplicate_reviews` | `sql/migrations/20260727_item_master_foundation.sql` |
| `item_master_aliases` | `sql/migrations/20260727_item_master_foundation.sql` |
| `item_master_audit_events` | `sql/migrations/20260727_item_master_foundation.sql` |
| `journal_entries` | `utils/ensureFinanceCoreTables.js:50` |
| `journal_entry_lines` | `utils/ensureFinanceCoreTables.js:64` |
| `legacy_item_mappings` | `sql/migrations/20260727_item_master_foundation.sql` |
| `maintainable_equipment` | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `maintenance_part_inventory_operations` | `sql/manual/025_maintenance_inventory_execution.sql` |
| `maintenance_work_order_allocators` | `sql/manual/024_maintenance_work_orders.sql` |
| `maintenance_work_order_parts` | `sql/manual/024_maintenance_work_orders.sql` |
| `maintenance_work_orders` | `sql/manual/024_maintenance_work_orders.sql` |
| `notification_outbox` | `backend-query-derived-contract` |
| `organization_head_reconciliation_decisions` | `sql/manual/016_organization_hierarchy_cutover_readiness.sql` |
| `organization_positions` | `sql/manual/014_organization_hierarchy.sql` |
| `organization_units` | `sql/manual/014_organization_hierarchy.sql` |
| `pending_item_requests` | `sql/migrations/20260727_item_master_foundation.sql` |
| `planning_settings` | `controllers/demandPlanningController.js:240` |
| `print_service_requests` | `routes/printServiceRequests.js:14` |
| `print_service_settings` | `routes/printServiceRequests.js:14` |
| `procurement_awards` | `sql/manual/006_connected_procure_to_pay.sql` |
| `procurement_case_activities` | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_case_complexity_factors` | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_cases` | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_evaluation_cases` | `backend-query-derived-contract` |
| `procurement_evaluation_criteria` | `backend-query-derived-contract` |
| `procurement_evaluation_offer_test_costs` | `backend-query-derived-contract` |
| `procurement_evaluation_offers` | `backend-query-derived-contract` |
| `procurement_evaluation_results` | `backend-query-derived-contract` |
| `procurement_evaluation_scores` | `backend-query-derived-contract` |
| `procurement_evaluation_tests` | `backend-query-derived-contract` |
| `procurement_identity_policy` | `sql/development/20261005_03_procurement_identity_policy.sql` |
| `procurement_item_events` | `sql/migrations/20260608_procurement_item_events.sql` |
| `procurement_priority_group_members` | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_groups` | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_history` | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_profiles` | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_value_events` | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `project_department_visibility` | `utils/ensureProjectsTable.js:36` |
| `request_auto_assignment_rules` | `utils/ensureRequestAutoAssignmentRulesTable.js:10` |
| `request_edit_approvals` | `utils/ensureRequestEditApprovalsTable.js:4` |
| `rfid_antennas` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_business_events` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_integration_clients` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_portal_antennas` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_portals` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_read_events` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_readers` | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfx_response_items` | `sql/manual/006_connected_procure_to_pay.sql` |
| `route_capability_policies` | `utils/capabilityPolicyService.js:5` |
| `spare_part_equipment_compatibility` | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `stock_item_master_mappings` | `sql/migrations/phase1b/02_stock_item_mapping_tables.sql` |
| `stock_item_migration_staging` | `sql/migrations/phase1b/02_stock_item_mapping_tables.sql` |
| `supplier_catalog_items` | `sql/migrations/20260727_item_master_foundation.sql` |
| `supplier_contacts` | `controllers/suppliersController.js:64` |
| `supplier_principals` | `sql/migrations/20260608_supplier_classification_principals.sql` |
| `user_section_assignments` | `backend-query-derived-contract` |

## Validation and backend follow-up

`node scripts/testBackendSchemaReconciliation.js` starts a digest-pinned PostgreSQL 16 Docker container with tmpfs storage and a randomized loopback-only database. It never reads application `DATABASE_URL` or imports runtime database helpers. Snapshot hashes prevent testing a stale fixture against changed inputs.

Verified: populated-partial-install rejection and transaction rollback; repeated application of all three patches; all 224 relations and 3,147 required column names; read-only preflight and postflight; existing user/catalog/grant/UI-row preservation; custom require-all access; toggle preservation; monotonically advancing sequences; new draft governance; generated UOM alias; inventory status splitting and duplicate rejection; posted inventory update/delete rejection; module RLS and browser-role read/write denial.

Static, complete, single-statement query literals passed directly to `query`/`one`/`many` were checked with EXPLAIN **without ANALYZE**, using null parameter bindings: **1,510 passed, 10 known pre-existing failures, zero unexpected failures**. Dynamic/assembled SQL and SQL stored indirectly in variables are not part of that count. The runner reports the known failures explicitly; it does not represent them as passing queries.

Five relevant existing Jest suites also passed: approval policy engine, approval shadow service, non-stock identity governance, canonical asset/equipment migration and connected P2P finance repository (**32 tests**).

The ten query failures cannot safely be solved by adding database tables/columns or weakening actor-ID types:

| Source | PostgreSQL error | Follow-up |
| --- | --- | --- |
| `controllers/requestedItems/updateProcurementStatusController.js:52` | `42P01`: relation "audit_log" does not exist | Unused legacy controller; no active import/route found. Uses singular `audit_log` instead of canonical `audit_logs`. |
| `controllers/requests/centralSupplyChainController.js:83` | `42804`: column "sent_to_central_supply_by" is of type integer but expression is of type text | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/approvalEngine.js:117` | `42P08`: inconsistent types deduced for parameter $1 | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/inventoryReservationService.js:110` | `42804`: column "consumed_by" is of type integer but expression is of type text | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/itemMasterFoundationService.js:378` | `42804`: column "resolved_by" is of type integer but expression is of type text | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/physicalInventoryService.js:36` | `42P08`: inconsistent types deduced for parameter $1 | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/rfidEventProcessor.js:14` | `0A000`: FOR UPDATE cannot be applied to the nullable side of an outer join | Use `FOR UPDATE OF` the required non-null relation. |
| `services/rfidService.js:12` | `42P08`: inconsistent types deduced for parameter $7 | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `services/rfidService.js:13` | `42P08`: inconsistent types deduced for parameter $1 | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |
| `utils/technicalInspectionStatus.js:46` | `42P08`: inconsistent types deduced for parameter $1 | Correct SQL parameter casts/types; preserve numeric actor IDs and text audit entity IDs. |

These are follow-up backend fixes; this change supplies the database audit and manual patches only. It does not claim every ERP workflow is now operational.

The machine-readable contract, snapshot hashes, object provenance and query-failure inventory are in `docs/database-audit/`. Run the integration script after changing a patch. When backend definitions or snapshots change, re-audit before updating the manifest/fixture; the saved manifest is evidence of this revision, not an automatically authoritative contract for future code.
