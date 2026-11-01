# Backend versus Supabase exports — 1 November 2026

Reviewed current master `9196f661` (Asia/Baghdad), including the recently merged AUD-002/AUD-004 remediations. This is a backend-wide comparison, not a last-migration review. Original exports and frozen migrations remain unchanged. No Development or Production Supabase connection or SQL execution was performed.

## Findings by supplied file

| Repository export | What is present | What is missing or incompatible in that export |
| --- | --- | --- |
| `sql/View_Supabase_SQL.sql` | 100 table definitions / 1,355 column names | 153 additional table definitions and two views are absent. Four bare `character` payload fingerprint columns mean `CHAR(1)`, incompatible with canonical 64-character SHA-256 payloads. Index/function/trigger/RLS/sequence definitions are not exported, so their live presence is unknown. |
| `sql/permissions_Table.sql` | 152 catalog definitions | One confirmed backend capability definition: `approval-authority.cmo`, checked by `services/surgicalConsignmentModel.js:68`. No new grants are required merely to register its metadata. |
| `sql/UI_resource_permissions.sql` | 36 saved resource rows | One current backend/default/frontend resource key: `feature.procurementPlanning`. The saved `feature.demandPlanning` empty permission list differs from current backend defaults; this is a policy difference, not a missing key. |

The reconciled structural inventory contains **253 physical tables, two views, 3,440 physical-table column names and 18 view column names** (3,458 total). All 100 existing-table column-name sets cover the planned static queries once the wrong planning column reference is corrected. This does not certify compatible live types, defaults, indexes, stored function bodies, policies or historical data.

**Absent from an export is not proof of live absence.** Its own foreign keys reference unexported objects such as `generic_items`, `approved_products`, `notification_outbox`, assets and canonical awards. Use the read-only verification file to determine actual live object gaps yourself; do not execute the context export as a migration.

The context export is not executable: two fields are generic `ARRAY`, two checks end with truncated `NOT VALI)`, and `item_uom.name text DEFAULT uom_name` is not a valid PostgreSQL column default. Only the disposable fixture normalizes these artifacts and defers omitted foreign-key targets. The original export is preserved. The verifier flags an ordinary UOM `name` column for review; it does not assume that an invalid context-export default proves how the live generated alias is installed.

## Complete SQL Editor files and application order

**MANUAL DATABASE MIGRATION REQUIRED** for confirmed gaps.

1. Run the complete **`sql/manual/063_backend_contract_verify.sql`** first. It is one read-only SELECT, safe when module tables are absent. Save its result table.
2. Review and run complete **`sql/manual/059_backend_contract_refresh.sql`** in Development during a write maintenance window. It is self-contained; do **not** first replay SQL 035–058 individually. It reconciles the older broad backend contract and the current technical, device demo, consignment, planning, timing and source dependencies together.
3. Run **`sql/manual/060_permission_catalog_refresh.sql`**. It registers the missing CMO capability by code, preserves existing metadata/IDs, advances a lagging permission sequence without lowering it, and grants nothing to users or roles.
4. Run **`sql/manual/061_ui_resource_catalog_refresh.sql`**. It additively registers current backend defaults; for the supplied snapshot only `feature.procurementPlanning` is inserted. Existing saved labels, descriptions, arrays and `require_all` choices remain unchanged.
5. **Optional, explicit UI policy alignment:** review **`sql/manual/062_demand_planning_ui_policy_alignment.sql`** if the empty saved demand-planning rule was the old default. It narrows visibility to one of `planning.view`, `planning.manage`, `replenishment.manage`, and only updates the exact exported empty-array/false policy. It preserves a concurrently customized rule, is retry-safe and audits the change in the same transaction. The actual export has an integer `audit_logs.target_id`, so the resource key is recorded in audit details rather than forced into that integer.
6. Rerun **063**. Required-object (`missing_or_invalid`) counts should be zero. `review` rows require assessment: compatible custom types/defaults/index names, intentional nullable legacy metadata, unvalidated historical FKs and customized UI policy must not be blindly overwritten just to clear every informational result.

Each file can be pasted directly into Supabase SQL Editor; there are no psql `\i` includes, application migrations or external file dependencies. The structural file is large because it covers the whole backend. It uses transactional DDL, a three-second lock timeout and a five-minute statement timeout. A conflict aborts instead of deleting hospital records or fabricating required values. PostgreSQL sequence advances are not transactional; sequence repairs only move forward and may leave harmless gaps after an aborted attempt.

After Development review, any Production application is a separate owner-operated rollout. Do not run any of these against hosted Supabase automatically.

## Structural changes and preservation rules

- Current activation/timing/technical-immutability functions and triggers are installed or refreshed from their maintained contracts; review any custom live function bodies before applying. Approval history is not backfilled and V2 is not activated.
- Use reviewed current backend/runtime DDL and maintained structural contracts across all domains. The package adds genuinely absent modules, columns, indexes, functions, triggers and backend-private RLS declarations; it preserves existing business rows, document/approval histories and explicit grants.
- Known optional evaluation metadata repairs from SQL 038–043 are incorporated conditionally. Historical quantities, timestamps, optional models, stability metadata and alternative flags remain NULL when unknown; defaults are set separately for future rows. Other populated partial modules missing required identities/states/signatures stop for explicit compatibility review.
- All four existing narrow payload fields are covered: `goods_receipts.payload_fingerprint`, `supplier_invoices.payload_fingerprint`, `ap_vouchers.payload_fingerprint`, `payment_records.payload_fingerprint`. Only provably narrow character/varchar fields are widened to text. Existing hash bytes are not fabricated, padded or replaced. Already truncated historical hashes cannot be recovered by widening; reconcile retries from authoritative evidence without replaying posted payments or financial events.
- Notification idempotency requires a valid, ready, immediate **non-partial** single-key unique index. The package checks semantics for both `notifications(outbox_event_id)` and `notification_outbox(idempotency_key)` and creates the required full index when necessary. This repairs the prerequisite behind “Canonical in-app outbox notification uniqueness is required.” An existing partial same-name index is not mistaken for a compatible full index. Duplicate non-NULL history stops and rolls back; no notification is deleted or merged.
- The older global `planning_settings_warehouse_key` and `request_auto_assignment_rules_unique_scope` indexes are not recreated. Current institute-scoped replacements remain authoritative, including on repeated runs with two institutes storing the same global/default request-type scope.
- No automatic role grants from the historical planning patch are replayed. Existing permissions, role/user grants, custom UI resources, explicit procurement identity policy choices and monotonic number sequences are preserved. Catalog registration does not imply authority assignment.
- Planning ownership is bound only where its existing warehouse/department provenance proves an institute, with the maintained audit. Global/unverifiable historical settings and assignment rules remain unassigned; request owners and technical signatures are never guessed from current creators or assignees.
- Current technical retention guards preserve actual referenced evidence. No inspection acceptance, technical approval, award, invoice, payable, inventory movement, payment or live approval is fabricated. Installing required structures is not approval of historical evidence.

## Backend repair that SQL must not hide

Static planning found a real current-code defect in `services/planningAuthorizationService.js`: its requested-item lookup selected `r.warehouse_id`, but the actual request model stores `r.supply_warehouse_id`. Adding a nullable `requests.warehouse_id` would create a misleading second authority and could bypass the intended warehouse check.

The backend query now uses `r.supply_warehouse_id AS request_warehouse_id`. Its regression fixture uses that real field and still rejects unauthorized/foreign warehouses while accepting the actual authorized warehouse. **The backend code fix must be reviewed/deployed separately; a SQL Editor patch alone cannot correct a wrong deployed query.** No institute, department, warehouse or request-approval bypass was introduced.

## Method and validation

The audit reads controllers, routes, services, repositories, middleware, runtime schema helpers, permission definitions/default mappings, maintained SQL and concrete UI resource consumers. Permission candidates were distinguished from translation keys and audit action names; for example `inventory.columns.quantity` and `planning.defaults.saved` are not missing authorization capabilities. Current backend defaults (30 resources) and 34 concrete backend/frontend resource keys were checked against the 36 saved rows.

`npm run test:backend-contract-refresh` starts a digest-pinned disposable PostgreSQL 16 container with tmpfs storage, a random database/password and an explicit loopback-only guard. It reconstructs the supplied current exports without reading/using the application's configured database connection. A source-only VM loads pure dynamic SQL generators with database access replaced by throwing stubs; it cannot call the real application pool.

Executed results:

- Complete structural/catalog patch applied **twice successfully** against the reconstructed exports.
- Read-only preflight identifies actual gaps; postflight has **zero required-object failures** after the patches.
- **1,755 directly passed static queries + 95 additional indirect static query literals + 18 generated financial/RFx/evaluation predicates = 1,868 PostgreSQL EXPLAIN checks passed**, zero unexpected complete-query failures. EXPLAIN is without ANALYZE and does not execute application business mutations.
- Extraction inspected **19,596 backend string literals / 2,792 SQL-like literals**. Seventeen non-direct candidates are application English messages or correlated/incomplete fragments, classified in `current/indirect-query-review.json`; they are not claimed as failed deployed SQL. Other dynamically assembled statements need representative workflow execution; this is not a proof of every possible data-dependent query.
- Preservation checks passed for existing permission metadata/IDs, saved UI rules and user/role grants; populated ambiguous modules abort; duplicate notification history aborts without deletion; a partial notification index is upgraded semantically; exact-match optional UI alignment preserves concurrent custom policies and emits one audit on retry.
- Known populated evaluation result upgrade preserves amounts/scores and unknown historical timestamps. Repeated application preserves per-institute global defaults, assignment rules and an explicitly disabled Item Master enforcement choice.
- Planning authorization regression: **13 tests passed**, including canonical warehouse selection and foreign/unauthorized warehouse denial.
- Full backend Jest: **219 suites / 1,854 tests passed; three baseline suites/tests failed**. All three reproduced on unchanged `9196f661`: `fetchRequestsController.domain.test.js`, `procurementHistoryController.test.js` (existing SQL-shape expectations), `phase5aCanonicalItemWriterBoundary.test.js` (existing reconciliation-script DML classification). No new remediation Jest failure.
- Changed JavaScript syntax and diff checks passed. No frontend source changed; no frontend rebuild is required by the query repair.

## Remaining limits and rollout

This is export-to-backend structural evidence, not a hosted audit. Live RLS policies, role grants, compatible custom indexes, exact function bodies, concurrency at hospital scale, source ownership/data integrity and backup/restore readiness remain unverified. The read-only catalog report establishes object availability; it does not authorize business operations or certify every existing row.

Do not bulk assign new capabilities to role names, backfill institute ownership from current users, synthesize technical signatures, replace old hashes with guessed payloads or replay financial/inventory history. Existing NULL ownership, missing approval evidence or inconsistent parents can remain intentionally blocked by current backend security after the schema is repaired.

The `item_uom.name` export artifact needs live generated/default/value review if reported; an ordinary custom display column is not automatically dropped or rewritten. Existing nullable compatibility fields and NOT VALID historical FKs may be deliberate preservation measures. Review them against actual evidence rather than coercing unknown history.

No merge or deployment was performed. LIVE_ROUTING_ENABLED remains FALSE and the existing approval engine remains authoritative. The unrelated installed skill files/lock changes are preserved outside this patch.

## Complete relation definitions absent from the supplied schema export

These are missing export definitions, not confirmed live absence. Provenance is the current module SQL or earlier reviewed backend-wide contract. The exact column/type/default inventory and installed object definitions are in `database-audit/current/required-columns.json` and `database-objects.json`.

| Relation | Kind | Definition provenance |
| --- | --- | --- |
| `ai_interactions` | table | `sql/manual/033_ai_intelligence_foundation.sql` |
| `ai_tool_executions` | table | `sql/manual/033_ai_intelligence_foundation.sql` |
| `approval_authority_delegations` | table | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approval_policies` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rule_conditions` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rule_steps` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_rules` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_differences` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_runs` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_shadow_steps` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_policy_versions` | table | `sql/manual/015_approval_policy_engine_foundation.sql` |
| `approval_route_snapshot_steps` | table | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approval_route_snapshots` | table | `sql/manual/032_approval_engine_operationalization_phase1.sql` |
| `approved_products` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `approved_spare_parts` | table | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `asset_categories` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_exceptions` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_inventory_discoveries` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_expected_assets` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_findings` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_number_allocators` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_observations` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_resolutions` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_inventory_sessions` | table | `sql/manual/030_fixed_asset_physical_inventory.sql` |
| `asset_locations` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_movements` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_number_allocators` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `asset_tags` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `assets` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `contract_ai_extractions` | table | `controllers/contractsController.js:3743` |
| `contract_alerts` | table | `controllers/contractsController.js:995` |
| `contract_amendments` | table | `controllers/contractsController.js:981` |
| `contract_approvals` | table | `controllers/contractsController.js:1007` |
| `contract_clause_assignments` | table | `controllers/contractGovernanceController.js:63` |
| `contract_clauses` | table | `controllers/contractGovernanceController.js:50` |
| `contract_consumption` | table | `controllers/contractsController.js:3797` |
| `contract_document_versions` | table | `controllers/contractsController.js:1123` |
| `contract_documents` | table | `controllers/contractsController.js:1109` |
| `contract_equipment_coverage` | table | `sql/manual/021_contract_equipment_coverage.sql` |
| `contract_invoices` | table | `controllers/contractsController.js:3774` |
| `contract_items` | table | `controllers/contractsController.js:1034` |
| `contract_legal_reviews` | table | `controllers/contractGovernanceController.js:116` |
| `contract_logs` | table | `controllers/contractsController.js:1077` |
| `contract_negotiations` | table | `controllers/contractGovernanceController.js:102` |
| `contract_obligations` | table | `controllers/contractsController.js:1170` |
| `contract_payments` | table | `controllers/contractsController.js:3791` |
| `contract_renewal_events` | table | `controllers/contractsController.js:1181` |
| `contract_required_documents` | table | `controllers/contractsController.js:1064` |
| `contract_risk_assessments` | table | `controllers/contractsController.js:3742` |
| `contract_sla_events` | table | `controllers/contractGovernanceController.js:89` |
| `contract_templates` | table | `controllers/contractGovernanceController.js:35` |
| `contract_versions` | table | `controllers/contractGovernanceController.js:142` |
| `delivery_inspection_assignments` | table | `sql/manual/054_technical_review_and_delivery_workflow.sql` |
| `delivery_inspection_tasks` | table | `sql/manual/054_technical_review_and_delivery_workflow.sql` |
| `department_item_follow_up_notes` | table | `utils/ensureDepartmentItemFollowUpNotesTable.js:8` |
| `department_priority_rankings` | table | `sql/manual/012_procurement_priority_foundation.sql` |
| `device_demo_candidates` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `device_demo_events` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `device_demo_reports` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `device_demo_reviewers` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `device_demo_selections` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `device_demo_workspaces` | table | `sql/manual/050_device_demo_workspaces.sql` |
| `document_branding_settings` | table | `sql/migrations/20260929_document_branding.sql` |
| `employee_tasks` | table | `sql/development/20261005_02_employee_tasks.sql` |
| `generic_item_merges` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `generic_items` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `inventory_cycle_count_lines` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_cycle_counts` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservation_allocations` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservation_issue_operations` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_reservations` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_transaction_allocations` | table | `sql/manual/004_inventory_transaction_engine.sql` |
| `inventory_transfer_allocation_links` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_transfer_movement_links` | table | `sql/manual/005_inventory_operations.sql` |
| `inventory_transfer_receipt_operations` | table | `sql/manual/005_inventory_operations.sql` |
| `invoice_match_override_decisions` | table | `sql/manual/006_connected_procure_to_pay.sql` |
| `item_duplicate_reviews` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `item_master_aliases` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `item_master_audit_events` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `journal_entries` | table | `utils/ensureFinanceCoreTables.js:50` |
| `journal_entry_lines` | table | `utils/ensureFinanceCoreTables.js:64` |
| `legacy_item_mappings` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `maintainable_equipment` | table | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `maintenance_approval_reporting_policy` | table | `sql/manual/046_maintenance_approval_reporting_policy.sql` |
| `maintenance_part_inventory_operations` | table | `sql/manual/025_maintenance_inventory_execution.sql` |
| `maintenance_work_order_allocators` | table | `sql/manual/024_maintenance_work_orders.sql` |
| `maintenance_work_order_parts` | table | `sql/manual/024_maintenance_work_orders.sql` |
| `maintenance_work_orders` | table | `sql/manual/024_maintenance_work_orders.sql` |
| `notification_outbox` | table | `backend-query-derived-contract` |
| `organization_head_reconciliation_decisions` | table | `sql/manual/016_organization_hierarchy_cutover_readiness.sql` |
| `organization_positions` | table | `sql/manual/014_organization_hierarchy.sql` |
| `organization_units` | table | `sql/manual/014_organization_hierarchy.sql` |
| `pending_item_requests` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `planning_settings` | table | `sql/manual/056_planning_authorization_scope.sql` |
| `preprocurement_technical_review_assignments` | table | `sql/manual/049_preprocurement_technical_reviews.sql` |
| `preprocurement_technical_review_policy` | table | `sql/manual/049_preprocurement_technical_reviews.sql` |
| `preprocurement_technical_reviews` | table | `sql/manual/049_preprocurement_technical_reviews.sql` |
| `print_service_requests` | table | `routes/printServiceRequests.js:14` |
| `print_service_settings` | table | `routes/printServiceRequests.js:14` |
| `procurement_awards` | table | `sql/manual/006_connected_procure_to_pay.sql` |
| `procurement_case_activities` | table | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_case_complexity_factors` | table | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_cases` | table | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `procurement_evaluation_cases` | table | `backend-query-derived-contract` |
| `procurement_evaluation_criteria` | table | `backend-query-derived-contract` |
| `procurement_evaluation_offer_test_costs` | table | `backend-query-derived-contract` |
| `procurement_evaluation_offers` | table | `backend-query-derived-contract` |
| `procurement_evaluation_results` | table | `backend-query-derived-contract` |
| `procurement_evaluation_scores` | table | `backend-query-derived-contract` |
| `procurement_evaluation_tests` | table | `backend-query-derived-contract` |
| `procurement_identity_policy` | table | `sql/development/20261005_03_procurement_identity_policy.sql` |
| `procurement_item_events` | table | `sql/migrations/20260608_procurement_item_events.sql` |
| `procurement_priority_group_members` | table | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_groups` | table | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_history` | table | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_priority_profiles` | table | `sql/manual/012_procurement_priority_foundation.sql` |
| `procurement_value_events` | table | `sql/manual/010_supply_chain_performance_foundation.sql` |
| `project_department_visibility` | table | `utils/ensureProjectsTable.js:36` |
| `request_auto_assignment_rules` | table | `sql/manual/057_autoassignment_authorization_scope.sql` |
| `request_edit_approvals` | table | `utils/ensureRequestEditApprovalsTable.js:4` |
| `request_priority_rankings` | table | `sql/manual/047_whole_request_priorities.sql` |
| `rfid_antennas` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_business_events` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_integration_clients` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_portal_antennas` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_portals` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_read_events` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfid_readers` | table | `sql/manual/017_fixed_assets_rfid_core.sql` |
| `rfx_response_items` | table | `sql/manual/006_connected_procure_to_pay.sql` |
| `route_capability_policies` | table | `utils/capabilityPolicyService.js:5` |
| `spare_part_equipment_compatibility` | table | `sql/manual/013_approved_spare_parts_foundation.sql` |
| `stock_item_identity_read_model` | view | `backend read-model/view contract` |
| `stock_item_mapping_coverage` | view | `backend read-model/view contract` |
| `stock_item_master_mappings` | table | `sql/migrations/phase1b/02_stock_item_mapping_tables.sql` |
| `stock_item_migration_staging` | table | `sql/migrations/phase1b/02_stock_item_mapping_tables.sql` |
| `supplier_catalog_items` | table | `sql/migrations/20260727_item_master_foundation.sql` |
| `supplier_contacts` | table | `controllers/suppliersController.js:64` |
| `supplier_principals` | table | `sql/migrations/20260608_supplier_classification_principals.sql` |
| `surgical_consignment_approvals` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_attestations` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_billing_lines` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_cases` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_department_settings` | table | `sql/manual/053_surgical_consignment_department_routing.sql` |
| `surgical_consignment_events` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_files` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_receipt_lines` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_receipts` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_returns` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_section_nurses` | table | `sql/manual/053_surgical_consignment_department_routing.sql` |
| `surgical_consignment_usage_lines` | table | `sql/manual/051_surgical_consignment.sql` |
| `surgical_consignment_waivers` | table | `sql/manual/051_surgical_consignment.sql` |
| `technical_evidence_references` | table | `sql/manual/054_technical_review_and_delivery_workflow.sql` |
| `technical_review_profiles` | table | `sql/manual/054_technical_review_and_delivery_workflow.sql` |
| `technical_workflow_history` | table | `sql/manual/054_technical_review_and_delivery_workflow.sql` |
| `user_section_assignments` | table | `backend-query-derived-contract` |

## Review artifacts

- `database-audit/current/contract-refresh.json`: baseline/snapshot hashes and reviewed structural sources.
- `database-audit/current/validation-results.json`: scope, gaps and executed planning counts.
- `database-audit/current/required-columns.json`: all required relation/column declarations after reconciliation.
- `database-audit/current/database-objects.json`: relations, indexes, functions and triggers from the disposable contract.
- `database-audit/current/permission-review.json`: missing capability evidence and excluded false positives.
- `database-audit/current/ui-policy-review.json`: missing resource and existing policy difference.
- `database-audit/current/indirect-query-review.json`: classified non-query/fragment candidates.
