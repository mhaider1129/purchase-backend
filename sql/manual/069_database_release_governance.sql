-- MANUAL DATABASE MIGRATION REQUIRED. Review in Development first.
-- Prerequisites: reviewed canonical 059/060/061 and current 064/065/066/067/068 contracts.
-- Creates no historical migration receipts and backfills no business evidence.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5min';
DO $$ BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0)) THEN
  RAISE EXCEPTION 'DATABASE_RELEASE_BUSY';
 END IF;
 IF to_regprocedure('public.canonical_procurement_completion(integer,integer,integer)') IS NULL OR to_regprocedure('public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)') IS NULL THEN
  RAISE EXCEPTION 'DATABASE_RELEASE_PREREQUISITES_MISSING: review SQL 067/068';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend') THEN
  CREATE ROLE purchase_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
 ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend' AND (rolsuper OR rolcreatedb OR rolcreaterole OR NOT rolbypassrls)) THEN
  RAISE EXCEPTION 'DATABASE_BACKEND_ROLE_REQUIRES_REVIEW';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.database_release_migrations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 migration_id text NOT NULL,
 filename text NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 execution_environment text NOT NULL CHECK(execution_environment IN ('development','staging','production','disposable')),
 execution_status text NOT NULL CHECK(execution_status IN ('APPLIED','FAILED','UNVERIFIED')),
 execution_actor text NOT NULL CHECK(length(trim(execution_actor))>0),
 database_actor name NOT NULL DEFAULT session_user,
 duration_ms numeric NOT NULL CHECK(duration_ms>=0),
 application_release_ref text NOT NULL CHECK(length(trim(application_release_ref))>0),
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 CHECK(execution_status<>'APPLIED' OR (migration_id ~ '^[0-9]{3,}_[a-z0-9_]+$' AND substring(migration_id FROM '^([0-9]+)')::integer>=69))
);
CREATE UNIQUE INDEX IF NOT EXISTS database_release_migrations_applied_once ON public.database_release_migrations(execution_environment,migration_id) WHERE execution_status='APPLIED';
CREATE TABLE IF NOT EXISTS public.database_release_attestations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 contract_version text NOT NULL,
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[0-9a-f]{64}$'),
 application_manifest_sha256 text NOT NULL CHECK(application_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 observed_schema_sha256 text NOT NULL CHECK(observed_schema_sha256 ~ '^[0-9a-f]{64}$'),
 execution_environment text NOT NULL CHECK(execution_environment IN ('development','staging','production','disposable')),
 application_release_ref text NOT NULL CHECK(length(trim(application_release_ref))>0),
 reviewed_by text NOT NULL CHECK(length(trim(reviewed_by))>0),
 database_actor name NOT NULL DEFAULT session_user,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence_kind text NOT NULL DEFAULT 'CURRENT_SCHEMA_VERIFIED_NOT_HISTORICAL_EXECUTION' CHECK(evidence_kind='CURRENT_SCHEMA_VERIFIED_NOT_HISTORICAL_EXECUTION'),
 UNIQUE(execution_environment,application_release_ref,contract_version,contract_sha256,observed_schema_sha256)
);
CREATE OR REPLACE FUNCTION public.preserve_database_release_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'DATABASE_RELEASE_EVIDENCE_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS preserve_database_release_evidence ON public.database_release_migrations;
CREATE TRIGGER preserve_database_release_evidence BEFORE UPDATE OR DELETE ON public.database_release_migrations FOR EACH ROW EXECUTE FUNCTION public.preserve_database_release_evidence();
DROP TRIGGER IF EXISTS preserve_database_release_evidence ON public.database_release_attestations;
CREATE TRIGGER preserve_database_release_evidence BEFORE UPDATE OR DELETE ON public.database_release_attestations FOR EACH ROW EXECUTE FUNCTION public.preserve_database_release_evidence();
ALTER TABLE public.database_release_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_release_attestations ENABLE ROW LEVEL SECURITY;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM purchase_backend;
GRANT USAGE ON SCHEMA public TO purchase_backend;
-- Trusted server role: application object authorization remains in canonical services.
-- Scope grants/revocations to reviewed repository objects, never custom host tables.
DO $security$
DECLARE item record; browser name;
BEGIN
 FOR item IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY['ai_interactions','ai_tool_executions','ap_payables','ap_voucher_lines','ap_vouchers','approval_authority_delegations','approval_logs','approval_policies','approval_policy_rule_conditions','approval_policy_rule_steps','approval_policy_rules','approval_policy_shadow_differences','approval_policy_shadow_runs','approval_policy_shadow_steps','approval_policy_versions','approval_route_rules','approval_route_snapshot_steps','approval_route_snapshots','approval_route_versions','approval_routes','approvals','approved_products','approved_spare_parts','asset_categories','asset_exceptions','asset_inventory_discoveries','asset_inventory_expected_assets','asset_inventory_findings','asset_inventory_number_allocators','asset_inventory_observations','asset_inventory_resolutions','asset_inventory_sessions','asset_locations','asset_movements','asset_number_allocators','asset_tags','assets','attachments','audit_logs','audit_registry_entries','budget_envelopes','commitment_ledger','contract_ai_extractions','contract_alerts','contract_amendments','contract_approvals','contract_clause_assignments','contract_clauses','contract_consumption','contract_document_versions','contract_documents','contract_equipment_coverage','contract_evaluations','contract_financial_reviews','contract_invoices','contract_items','contract_legal_reviews','contract_logs','contract_negotiations','contract_obligations','contract_payments','contract_renewal_events','contract_required_documents','contract_risk_assessments','contract_sla_events','contract_templates','contract_versions','contracts','custody_records','data_scopes','database_release_attestations','database_release_migrations','delivery_inspection_assignments','delivery_inspection_tasks','department_item_follow_up_notes','department_priority_rankings','department_stock_levels','department_stock_movements','departments','device_demo_candidates','device_demo_events','device_demo_reports','device_demo_reviewers','device_demo_selections','device_demo_workspaces','document_branding_settings','document_flow_links','employee_tasks','evaluation_criteria','finance_action_history','finance_chart_of_accounts','finance_cost_centers','finance_postings','generic_item_merges','generic_items','gl_posting_lines','gl_postings','goods_receipt_inventory_status_links','goods_receipt_items','goods_receipts','governance_audit_trail','institutes','inventory_cycle_count_lines','inventory_cycle_counts','inventory_reservation_allocations','inventory_reservation_issue_operations','inventory_reservations','inventory_transaction_allocations','inventory_transactions','inventory_transfer_allocation_links','inventory_transfer_movement_links','inventory_transfer_receipt_operations','invoice_items','invoice_match_override_decisions','invoice_match_results','item_brands','item_categories','item_conversion','item_duplicate_reviews','item_manufacturers','item_master','item_master_aliases','item_master_audit_events','item_master_documents','item_master_items','item_recalls','item_uom','item_variants','journal_entries','journal_entry_lines','legacy_item_mappings','maintainable_equipment','maintenance_approval_reporting_policy','maintenance_part_inventory_operations','maintenance_stock','maintenance_work_order_allocators','maintenance_work_order_parts','maintenance_work_orders','monthly_dispensing','non_po_receipt_approvals','notification_outbox','notifications','organization_head_reconciliation_decisions','organization_positions','organization_units','payment_allocations','payment_records','pending_item_requests','permissions','planning_settings','preprocurement_technical_review_assignments','preprocurement_technical_review_policy','preprocurement_technical_reviews','print_service_requests','print_service_settings','procurement_awards','procurement_case_activities','procurement_case_complexity_factors','procurement_cases','procurement_evaluation_cases','procurement_evaluation_criteria','procurement_evaluation_offer_test_costs','procurement_evaluation_offers','procurement_evaluation_results','procurement_evaluation_scores','procurement_evaluation_tests','procurement_identity_policy','procurement_item_events','procurement_lifecycle_states','procurement_plan_item_consumptions','procurement_plan_item_requests','procurement_plan_items','procurement_plans','procurement_priority_group_members','procurement_priority_groups','procurement_priority_history','procurement_priority_profiles','procurement_state_history','procurement_value_events','project_department_visibility','projects','purchase_order_items','purchase_orders','request_auto_assignment_rules','request_edit_approvals','request_logs','request_priority_rankings','requested_item_financials','requested_items','requests','rfid_antennas','rfid_business_events','rfid_integration_clients','rfid_portal_antennas','rfid_portals','rfid_read_events','rfid_readers','rfx_events','rfx_response_items','rfx_responses','risk_register','role_data_scopes','role_permissions','roles','route_capability_policies','sections','spare_part_equipment_compatibility','stock_item_identity_read_model','stock_item_mapping_coverage','stock_item_master_mappings','stock_item_migration_staging','stock_item_requests','stock_items','supplier_catalog_items','supplier_compliance_artifacts','supplier_contacts','supplier_document_submissions','supplier_evaluations','supplier_invoices','supplier_issues','supplier_portal_sessions','supplier_principals','supplier_scorecards','supplier_users','suppliers','surgical_consignment_approvals','surgical_consignment_attestations','surgical_consignment_billing_lines','surgical_consignment_cases','surgical_consignment_department_settings','surgical_consignment_events','surgical_consignment_files','surgical_consignment_receipt_lines','surgical_consignment_receipts','surgical_consignment_returns','surgical_consignment_section_nurses','surgical_consignment_usage_lines','surgical_consignment_waivers','technical_evidence_references','technical_inspections','technical_review_profiles','technical_workflow_history','ui_resource_permissions','user_data_scopes','user_permissions','user_registration_requests','user_section_assignments','users','warehouse_item_batches','warehouse_replenishment_policies','warehouse_replenishment_tasks','warehouse_stock_levels','warehouse_stock_movements','warehouse_supplied_items','warehouse_supply_items','warehouse_supply_templates','warehouse_transfer_items','warehouse_transfer_requests','warehouses']::text[]) AND c.relkind IN ('r','p','v','m') LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',item.relname);
  FOREACH browser IN ARRAY ARRAY['anon','authenticated']::name[] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',item.relname,browser); END IF;
  END LOOP;
  IF item.relname NOT IN ('database_release_migrations','database_release_attestations') AND item.relkind IN ('r','p') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO purchase_backend',item.relname);
  ELSE EXECUTE format('GRANT SELECT ON TABLE public.%I TO purchase_backend',item.relname); END IF;
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY['approval_active_elapsed_seconds','approval_route_snapshot_guard','approval_route_snapshot_validate','approve_stock_item_request','canonical_procurement_completion','canonical_receipt_inventory_quantity','canonical_supply_quantity','enforce_rfid_antenna_scope_update','enforce_rfid_portal_antenna_scope','enforce_rfid_portal_enable_scope','enforce_rfid_reader_scope_update','guard_canonical_contract_po_source','guard_canonical_invoice_contract_source','guard_contract_canonical_commitment','keep_technical_history_immutable','next_asset_inventory_number','next_asset_number','next_maintenance_work_order_number','preserve_contract_financial_reviews','preserve_database_release_evidence','preserve_receipt_status_link','prevent_inventory_allocation_mutation','prevent_inventory_snapshot_mutation','prevent_posted_inventory_mutation','record_approval_activation_time','validate_organization_position_user','validate_organization_unit','validate_stock_mapping_target']::text[]) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.signature);
  FOREACH browser IN ARRAY ARRAY['anon','authenticated']::name[] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.signature,browser); END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO purchase_backend',item.signature);
 END LOOP;
 FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid=d.refobjid WHERE d.objid=c.oid AND t.relname NOT IN ('database_release_migrations','database_release_attestations') AND t.relname=ANY(ARRAY['ai_interactions','ai_tool_executions','ap_payables','ap_voucher_lines','ap_vouchers','approval_authority_delegations','approval_logs','approval_policies','approval_policy_rule_conditions','approval_policy_rule_steps','approval_policy_rules','approval_policy_shadow_differences','approval_policy_shadow_runs','approval_policy_shadow_steps','approval_policy_versions','approval_route_rules','approval_route_snapshot_steps','approval_route_snapshots','approval_route_versions','approval_routes','approvals','approved_products','approved_spare_parts','asset_categories','asset_exceptions','asset_inventory_discoveries','asset_inventory_expected_assets','asset_inventory_findings','asset_inventory_number_allocators','asset_inventory_observations','asset_inventory_resolutions','asset_inventory_sessions','asset_locations','asset_movements','asset_number_allocators','asset_tags','assets','attachments','audit_logs','audit_registry_entries','budget_envelopes','commitment_ledger','contract_ai_extractions','contract_alerts','contract_amendments','contract_approvals','contract_clause_assignments','contract_clauses','contract_consumption','contract_document_versions','contract_documents','contract_equipment_coverage','contract_evaluations','contract_financial_reviews','contract_invoices','contract_items','contract_legal_reviews','contract_logs','contract_negotiations','contract_obligations','contract_payments','contract_renewal_events','contract_required_documents','contract_risk_assessments','contract_sla_events','contract_templates','contract_versions','contracts','custody_records','data_scopes','database_release_attestations','database_release_migrations','delivery_inspection_assignments','delivery_inspection_tasks','department_item_follow_up_notes','department_priority_rankings','department_stock_levels','department_stock_movements','departments','device_demo_candidates','device_demo_events','device_demo_reports','device_demo_reviewers','device_demo_selections','device_demo_workspaces','document_branding_settings','document_flow_links','employee_tasks','evaluation_criteria','finance_action_history','finance_chart_of_accounts','finance_cost_centers','finance_postings','generic_item_merges','generic_items','gl_posting_lines','gl_postings','goods_receipt_inventory_status_links','goods_receipt_items','goods_receipts','governance_audit_trail','institutes','inventory_cycle_count_lines','inventory_cycle_counts','inventory_reservation_allocations','inventory_reservation_issue_operations','inventory_reservations','inventory_transaction_allocations','inventory_transactions','inventory_transfer_allocation_links','inventory_transfer_movement_links','inventory_transfer_receipt_operations','invoice_items','invoice_match_override_decisions','invoice_match_results','item_brands','item_categories','item_conversion','item_duplicate_reviews','item_manufacturers','item_master','item_master_aliases','item_master_audit_events','item_master_documents','item_master_items','item_recalls','item_uom','item_variants','journal_entries','journal_entry_lines','legacy_item_mappings','maintainable_equipment','maintenance_approval_reporting_policy','maintenance_part_inventory_operations','maintenance_stock','maintenance_work_order_allocators','maintenance_work_order_parts','maintenance_work_orders','monthly_dispensing','non_po_receipt_approvals','notification_outbox','notifications','organization_head_reconciliation_decisions','organization_positions','organization_units','payment_allocations','payment_records','pending_item_requests','permissions','planning_settings','preprocurement_technical_review_assignments','preprocurement_technical_review_policy','preprocurement_technical_reviews','print_service_requests','print_service_settings','procurement_awards','procurement_case_activities','procurement_case_complexity_factors','procurement_cases','procurement_evaluation_cases','procurement_evaluation_criteria','procurement_evaluation_offer_test_costs','procurement_evaluation_offers','procurement_evaluation_results','procurement_evaluation_scores','procurement_evaluation_tests','procurement_identity_policy','procurement_item_events','procurement_lifecycle_states','procurement_plan_item_consumptions','procurement_plan_item_requests','procurement_plan_items','procurement_plans','procurement_priority_group_members','procurement_priority_groups','procurement_priority_history','procurement_priority_profiles','procurement_state_history','procurement_value_events','project_department_visibility','projects','purchase_order_items','purchase_orders','request_auto_assignment_rules','request_edit_approvals','request_logs','request_priority_rankings','requested_item_financials','requested_items','requests','rfid_antennas','rfid_business_events','rfid_integration_clients','rfid_portal_antennas','rfid_portals','rfid_read_events','rfid_readers','rfx_events','rfx_response_items','rfx_responses','risk_register','role_data_scopes','role_permissions','roles','route_capability_policies','sections','spare_part_equipment_compatibility','stock_item_identity_read_model','stock_item_mapping_coverage','stock_item_master_mappings','stock_item_migration_staging','stock_item_requests','stock_items','supplier_catalog_items','supplier_compliance_artifacts','supplier_contacts','supplier_document_submissions','supplier_evaluations','supplier_invoices','supplier_issues','supplier_portal_sessions','supplier_principals','supplier_scorecards','supplier_users','suppliers','surgical_consignment_approvals','surgical_consignment_attestations','surgical_consignment_billing_lines','surgical_consignment_cases','surgical_consignment_department_settings','surgical_consignment_events','surgical_consignment_files','surgical_consignment_receipt_lines','surgical_consignment_receipts','surgical_consignment_returns','surgical_consignment_section_nurses','surgical_consignment_usage_lines','surgical_consignment_waivers','technical_evidence_references','technical_inspections','technical_review_profiles','technical_workflow_history','ui_resource_permissions','user_data_scopes','user_permissions','user_registration_requests','user_section_assignments','users','warehouse_item_batches','warehouse_replenishment_policies','warehouse_replenishment_tasks','warehouse_stock_levels','warehouse_stock_movements','warehouse_supplied_items','warehouse_supply_items','warehouse_supply_templates','warehouse_transfer_items','warehouse_transfer_requests','warehouses']::text[])) LOOP
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.%I TO purchase_backend',item.relname);
 END LOOP;
 REVOKE ALL ON public.database_release_migrations,public.database_release_attestations FROM purchase_backend;
 GRANT SELECT ON public.database_release_migrations,public.database_release_attestations TO purchase_backend;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE CREATE ON SCHEMA public FROM service_role;
  REVOKE ALL ON public.database_release_migrations,public.database_release_attestations FROM service_role;
  GRANT SELECT ON public.database_release_migrations,public.database_release_attestations TO service_role;
 END IF;
 -- Hosted default privileges must not leave release-evidence sequences writable.
 FOR item IN SELECT s.oid::regclass signature FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid WHERE n.nspname='public' AND s.relkind='S' AND t.relname IN ('database_release_migrations','database_release_attestations') LOOP
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC',item.signature);
  FOREACH browser IN ARRAY ARRAY['purchase_backend','service_role','anon','authenticated']::name[] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser) THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %I',item.signature,browser); END IF;
  END LOOP;
 END LOOP;
END $security$;
-- Reference accounts only; no journal, liability, settlement or historical amount backfill.
INSERT INTO public.finance_chart_of_accounts(code,name,account_type) VALUES
 ('5000-PROC-EXP','Procurement Expense','expense'),('2100-AP-ACCRUAL','Accounts Payable Accrual','liability') ON CONFLICT(code) DO NOTHING;

-- Catalog metadata only. No role/user capability grants or UI-policy overrides.
INSERT INTO public.permissions(code,name,description) VALUES
('finance.budget.manage','Manage financial budgets','Configure budget envelopes within the actor institute; no posting, payment or cross-institute authority.'),
('planning.view','View procurement planning','Read plans and advisory forecasts within authorized institute, department and warehouse scopes.'),
('planning.manage','Prepare procurement plans','Upload plans, add plan items and links, and maintain planning defaults in authorized scopes; no approval or procurement authority.'),
('replenishment.manage','Manage replenishment configuration','Maintain scoped replenishment policies and generate advisory tasks; no inventory or procurement posting authority.'),
('planning.cross-department','Plan across departments','Extend a planning capability across departments of the actor institute only.'),
('planning.cross-warehouse','Plan across warehouses','Extend a planning capability across warehouses of the actor institute only.'),
('ai-intelligence.use','Use AI Intelligence','Use the read-only, audited AI Intelligence assistant within existing data scopes.'),
('approval-policy.view','View approval policies','View approval policy definitions and versions.'),
('approval-policy.manage','Manage approval policies','Create policies and edit draft versions.'),
('approval-policy.publish-shadow','Publish approval policy to shadow','Move validated policy versions into shadow mode.'),
('approval-policy.run-shadow','Run approval policy shadow analysis','Evaluate requests without affecting live approvals.'),
('approval-policy.view-shadow','View approval policy shadow results','View shadow route comparisons and metrics.'),
('organization.manage','Manage organization hierarchy','Create, move, archive, and assign positions to organizational units.'),
('maintenance-requests.view-all','View all maintenance requests','Access the maintenance requests status page and view requests submitted by all users.'),
('requests.reclassify','Reclassify requests','Change a pre-procurement request type and replace its active approval route.'),
('procure-to-pay.lifecycle.view','View procure-to-pay lifecycle','View lifecycle, receipts, invoices, matching, finance and payment data for requests.'),
('procure-to-pay.receipts.manage','Manage goods receipts','Create and update goods receipt events including partial and discrepancy captures.'),
('procure-to-pay.invoices.manage','Manage supplier invoices','Capture supplier invoices and invoice line details.'),
('procure-to-pay.match.manage','Manage invoice matching','Run 2-way/3-way invoice matching and review mismatch details.'),
('finance.verify','Verify finance records','Perform finance review and verification before posting.'),
('finance.voucher.create','Create AP vouchers','Create AP voucher headers and lines within the internal finance module.'),
('finance.post-ledger','Post to internal ledger','Post verified vouchers to the internal liability recognition state.'),
('finance.payment.manage','Manage payment states','Mark payment pending and paid states for tracked liabilities.'),
('finance.override-mismatch','Override invoice mismatches','Approve authorized mismatches with reason codes for audit.'),
('roles.manage','Manage roles','Create, edit, and delete system roles.'),
('technical-inspections.manage','Manage technical inspections','Create, edit, and delete technical inspection records.'),
('rfx.manage','Manage RFX events','Publish and manage requests for proposals/quotations.'),
('rfx.respond','Respond to RFX events','Submit supplier responses to RFQ or RFP events.'),
('risks.view','View risk register','View organizational risks and mitigations.'),
('risks.manage','Manage risks','Create and update entries in the risk register.'),
('item-master.view','View item master','Search and view item master records and approved item details.'),
('item-master.manage','Manage item master records','Create and update item master records, metadata, and attachments before approval.'),
('item-master.approve','Approve item master records','Validate and approve or reject item master records for activation.'),
('item-master.create','Create generic items','Create governed generic item drafts'),
('item-master.edit','Edit generic items','Edit generic item master records'),
('item-master.validate','Validate generic items','Validate structured generic item records'),
('item-master.retire','Retire generic items','Retire active generic items'),
('item-master.map','Resolve item mappings','Resolve pending and duplicate mappings'),
('item-master.products','Manage approved products','Create and maintain approved products'),
('item-master.products.approve','Approve products','Approve exact manufactured products'),
('item-master.suppliers','Manage supplier catalog','Maintain supplier commercial records'),
('item-master.legacy-maintain','Maintain legacy mappings','Map compatibility items to normalized generic items'),
('item-master.free-text-exception','Approve free-text exceptions','Authorize exceptional non-catalog purchase lines'),
('fixed-assets.view','Fixed assets: view','view fixed asset records within institute scope.'),
('fixed-assets.create','Fixed assets: create','create fixed asset records within institute scope.'),
('fixed-assets.edit','Fixed assets: edit','edit fixed asset records within institute scope.'),
('fixed-assets.manage','Fixed assets: manage','manage fixed asset records within institute scope.'),
('fixed-assets.move','Fixed assets: move','move fixed asset records within institute scope.'),
('fixed-assets.verify','Fixed assets: verify','verify fixed asset records within institute scope.'),
('fixed-assets.manage-locations','Fixed assets: manage-locations','manage-locations fixed asset records within institute scope.'),
('fixed-assets.manage-categories','Fixed assets: manage-categories','manage-categories fixed asset records within institute scope.'),
('fixed-assets.view-financial','Fixed assets: view-financial','view-financial fixed asset records within institute scope.'),
('rfid.view','RFID: view','view RFID resources within institute scope.'),
('rfid.manage-tags','RFID: manage-tags','manage-tags RFID resources within institute scope.'),
('rfid.manage-infrastructure','RFID: manage-infrastructure','manage-infrastructure RFID resources within institute scope.'),
('rfid.view-raw-events','RFID: view-raw-events','view-raw-events RFID resources within institute scope.'),
('rfid.manage-exceptions','RFID: manage-exceptions','manage-exceptions RFID resources within institute scope.'),
('rfid.manage-integrations','RFID: manage-integrations','manage-integrations RFID resources within institute scope.')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.route_capability_policies(route_prefix,module,resource,permissions) VALUES
('/approval-polic','procurement-governance','approval-policy',ARRAY['approval-policy.view','approval-policy.manage','approval-policy.publish-shadow','approval-policy.run-shadow','approval-policy.view-shadow']::text[]),
('/assets','fixed-assets','assets',ARRAY['fixed-assets.view','fixed-assets.create','fixed-assets.edit','fixed-assets.manage','fixed-assets.move','fixed-assets.verify','fixed-assets.manage-locations','fixed-assets.manage-categories','fixed-assets.view-financial']::text[]),
('/rfid','fixed-assets','rfid',ARRAY['rfid.view','rfid.manage-tags','rfid.manage-infrastructure','rfid.view-raw-events','rfid.manage-exceptions','rfid.manage-integrations']::text[]),
('/admin-tools','platform-governance','admin-tools',ARRAY['users.manage','approvals.reassign']::text[]),
('/permissions','platform-governance','permission-catalog',ARRAY['permissions.manage']::text[]),
('/roles','platform-governance','role-management',ARRAY['roles.manage']::text[]),
('/users','identity-access','user-management',ARRAY['users.manage']::text[]),
('/ui-access','identity-access','ui-resource-policy',ARRAY['permissions.manage']::text[]),
('/requests','procurement','requests',ARRAY['requests.manage','requests.view-all']::text[]),
('/requested-items','procurement','requested-items',ARRAY['requests.manage','procurement.update-status','procurement.update-cost']::text[]),
('/approvals','procurement','approvals',ARRAY['approvals.reassign','requests.manage']::text[]),
('/contracts','sourcing','contracts',ARRAY['contracts.manage']::text[]),
('/suppliers','sourcing','suppliers',ARRAY['contracts.manage']::text[]),
('/supplier-evaluations','sourcing','supplier-evaluations',ARRAY['evaluations.manage']::text[]),
('/supplier-srm','sourcing','supplier-srm',ARRAY['evaluations.manage']::text[]),
('/rfx-portal','sourcing','rfx-portal',ARRAY['rfx.manage','rfx.respond']::text[]),
('/procure-to-pay','finance-core','procure-to-pay',ARRAY['procure-to-pay.lifecycle.view','procure-to-pay.receipts.manage','procure-to-pay.invoices.manage','procure-to-pay.match.manage','finance.verify','finance.voucher.create','finance.post-ledger','finance.payment.manage','finance.override-mismatch']::text[]),
('/warehouse-inventory','warehouse','inventory',ARRAY['warehouse.manage-supply','warehouse.view-supply']::text[]),
('/warehouse-supply','warehouse','supply',ARRAY['warehouse.manage-supply','warehouse.view-supply']::text[]),
('/warehouse-transfers','warehouse','transfers',ARRAY['warehouse.manage-supply','warehouse.view-supply']::text[]),
('/stock-items','warehouse','stock-items',ARRAY['warehouse.manage-supply']::text[]),
('/stock-item-requests','warehouse','stock-item-requests',ARRAY['stock-requests.create','stock-requests.review']::text[]),
('/item-master','master-data','item-master',ARRAY['item-master.view','item-master.manage','item-master.approve']::text[]),
('/item-recalls','quality','item-recalls',ARRAY['recalls.manage','recalls.view']::text[]),
('/risk-management','risk','risk-register',ARRAY['risks.manage','risks.view']::text[])
ON CONFLICT(route_prefix) DO NOTHING;

-- Move the existing contract-evaluation defaults out of request-time initialization.
-- Preserve configured components/roles and historical criterion identities.
DO $criteria_identity$ BEGIN
 IF EXISTS(SELECT 1 FROM public.evaluation_criteria WHERE code IS NULL AND lower(name)=ANY(ARRAY['contract compliance','supplier / contractor performance','financial performance','risk & issue management','sustainability & compliance','stakeholder satisfaction']::text[])) THEN
  RAISE EXCEPTION 'EVALUATION_CRITERIA_LEGACY_IDENTITY_REQUIRES_REVIEW';
 END IF;
END $criteria_identity$;
INSERT INTO public.evaluation_criteria(code,name,role,components) VALUES
 ('contract_compliance','Contract Compliance','SCM','["Adherence to contractual terms and deliverables","Compliance with agreed delivery or milestone schedules","Accuracy and completeness of required documentation","Effectiveness of variation and change-order control"]'::jsonb),
 ('supplier_contractor_performance','Supplier / Contractor Performance','HOD','["Quality of goods and services delivered","Responsiveness to issues, escalations, and queries","Technical competency and adherence to specifications","Collaboration with end user and technical departments"]'::jsonb),
 ('financial_performance','Financial Performance','SCM','["Adherence to budget, unit rates, and pricing agreements","Proactive cost control and savings opportunities","Accuracy and timeliness of invoices and supporting documents"]'::jsonb),
 ('risk_issue_management','Risk & Issue Management','CONTRACT_MANAGER','["Early identification and mitigation of emerging risks","Effectiveness of escalation and issue resolution actions","Compliance with governance and reporting requirements"]'::jsonb),
 ('sustainability_compliance','Sustainability & Compliance','OHS','["Compliance with health, safety, and environmental standards","Implementation of sustainable and responsible practices","Alignment with legal, regulatory, and audit requirements"]'::jsonb),
 ('stakeholder_satisfaction','Stakeholder Satisfaction','HOD','["Feedback from end users on service outcomes","Transparency and effectiveness of communication","Support for continuous improvement and lessons learned"]'::jsonb)
 ON CONFLICT(code) DO NOTHING;
COMMIT;
