-- MANUAL DATABASE MIGRATION REQUIRED. Do not run the context-only schema export.
-- Backend-wide structural reconciliation from runtime DDL, maintained SQL and active queries.
-- Run during a write maintenance window. Missing legacy values are not invented.
-- Existing tables/rows, approvals, identity mappings, grants and function bodies are preserved.
-- Unique/constraint conflicts fail and roll back; remediate data explicitly before retrying.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
SET LOCAL search_path = public, extensions, pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5min';

DO $preflight$ BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN RAISE EXCEPTION 'PostgreSQL 15+ is required for inventory identity'; END IF;
  IF to_regclass('public.ap_payables') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.ap_payables; stop and reconcile the export'; END IF;
  IF to_regclass('public.ap_voucher_lines') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.ap_voucher_lines; stop and reconcile the export'; END IF;
  IF to_regclass('public.ap_vouchers') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.ap_vouchers; stop and reconcile the export'; END IF;
  IF to_regclass('public.approval_logs') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.approval_logs; stop and reconcile the export'; END IF;
  IF to_regclass('public.approval_route_rules') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.approval_route_rules; stop and reconcile the export'; END IF;
  IF to_regclass('public.approval_route_versions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.approval_route_versions; stop and reconcile the export'; END IF;
  IF to_regclass('public.approval_routes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.approval_routes; stop and reconcile the export'; END IF;
  IF to_regclass('public.approvals') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.approvals; stop and reconcile the export'; END IF;
  IF to_regclass('public.attachments') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.attachments; stop and reconcile the export'; END IF;
  IF to_regclass('public.audit_logs') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.audit_logs; stop and reconcile the export'; END IF;
  IF to_regclass('public.audit_registry_entries') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.audit_registry_entries; stop and reconcile the export'; END IF;
  IF to_regclass('public.budget_envelopes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.budget_envelopes; stop and reconcile the export'; END IF;
  IF to_regclass('public.commitment_ledger') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.commitment_ledger; stop and reconcile the export'; END IF;
  IF to_regclass('public.contract_evaluations') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.contract_evaluations; stop and reconcile the export'; END IF;
  IF to_regclass('public.contracts') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.contracts; stop and reconcile the export'; END IF;
  IF to_regclass('public.custody_records') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.custody_records; stop and reconcile the export'; END IF;
  IF to_regclass('public.data_scopes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.data_scopes; stop and reconcile the export'; END IF;
  IF to_regclass('public.department_stock_levels') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.department_stock_levels; stop and reconcile the export'; END IF;
  IF to_regclass('public.department_stock_movements') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.department_stock_movements; stop and reconcile the export'; END IF;
  IF to_regclass('public.departments') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.departments; stop and reconcile the export'; END IF;
  IF to_regclass('public.document_flow_links') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.document_flow_links; stop and reconcile the export'; END IF;
  IF to_regclass('public.evaluation_criteria') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.evaluation_criteria; stop and reconcile the export'; END IF;
  IF to_regclass('public.finance_action_history') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.finance_action_history; stop and reconcile the export'; END IF;
  IF to_regclass('public.finance_chart_of_accounts') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.finance_chart_of_accounts; stop and reconcile the export'; END IF;
  IF to_regclass('public.finance_cost_centers') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.finance_cost_centers; stop and reconcile the export'; END IF;
  IF to_regclass('public.finance_postings') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.finance_postings; stop and reconcile the export'; END IF;
  IF to_regclass('public.gl_posting_lines') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.gl_posting_lines; stop and reconcile the export'; END IF;
  IF to_regclass('public.gl_postings') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.gl_postings; stop and reconcile the export'; END IF;
  IF to_regclass('public.goods_receipt_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.goods_receipt_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.goods_receipts') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.goods_receipts; stop and reconcile the export'; END IF;
  IF to_regclass('public.governance_audit_trail') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.governance_audit_trail; stop and reconcile the export'; END IF;
  IF to_regclass('public.institutes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.institutes; stop and reconcile the export'; END IF;
  IF to_regclass('public.inventory_transactions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.inventory_transactions; stop and reconcile the export'; END IF;
  IF to_regclass('public.invoice_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.invoice_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.invoice_match_results') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.invoice_match_results; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_brands') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_brands; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_categories') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_categories; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_conversion') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_conversion; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_manufacturers') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_manufacturers; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_master') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_master; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_master_documents') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_master_documents; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_master_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_master_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_recalls') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_recalls; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_uom') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_uom; stop and reconcile the export'; END IF;
  IF to_regclass('public.item_variants') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.item_variants; stop and reconcile the export'; END IF;
  IF to_regclass('public.maintenance_stock') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.maintenance_stock; stop and reconcile the export'; END IF;
  IF to_regclass('public.monthly_dispensing') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.monthly_dispensing; stop and reconcile the export'; END IF;
  IF to_regclass('public.non_po_receipt_approvals') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.non_po_receipt_approvals; stop and reconcile the export'; END IF;
  IF to_regclass('public.notifications') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.notifications; stop and reconcile the export'; END IF;
  IF to_regclass('public.payment_allocations') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.payment_allocations; stop and reconcile the export'; END IF;
  IF to_regclass('public.payment_records') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.payment_records; stop and reconcile the export'; END IF;
  IF to_regclass('public.permissions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.permissions; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_lifecycle_states') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_lifecycle_states; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_plan_item_consumptions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_plan_item_consumptions; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_plan_item_requests') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_plan_item_requests; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_plan_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_plan_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_plans') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_plans; stop and reconcile the export'; END IF;
  IF to_regclass('public.procurement_state_history') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.procurement_state_history; stop and reconcile the export'; END IF;
  IF to_regclass('public.projects') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.projects; stop and reconcile the export'; END IF;
  IF to_regclass('public.purchase_order_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.purchase_order_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.purchase_orders') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.purchase_orders; stop and reconcile the export'; END IF;
  IF to_regclass('public.request_logs') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.request_logs; stop and reconcile the export'; END IF;
  IF to_regclass('public.requested_item_financials') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.requested_item_financials; stop and reconcile the export'; END IF;
  IF to_regclass('public.requested_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.requested_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.requests') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.requests; stop and reconcile the export'; END IF;
  IF to_regclass('public.rfx_events') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.rfx_events; stop and reconcile the export'; END IF;
  IF to_regclass('public.rfx_responses') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.rfx_responses; stop and reconcile the export'; END IF;
  IF to_regclass('public.risk_register') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.risk_register; stop and reconcile the export'; END IF;
  IF to_regclass('public.role_data_scopes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.role_data_scopes; stop and reconcile the export'; END IF;
  IF to_regclass('public.role_permissions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.role_permissions; stop and reconcile the export'; END IF;
  IF to_regclass('public.roles') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.roles; stop and reconcile the export'; END IF;
  IF to_regclass('public.sections') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.sections; stop and reconcile the export'; END IF;
  IF to_regclass('public.stock_item_requests') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.stock_item_requests; stop and reconcile the export'; END IF;
  IF to_regclass('public.stock_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.stock_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_compliance_artifacts') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_compliance_artifacts; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_document_submissions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_document_submissions; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_evaluations') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_evaluations; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_invoices') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_invoices; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_issues') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_issues; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_portal_sessions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_portal_sessions; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_scorecards') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_scorecards; stop and reconcile the export'; END IF;
  IF to_regclass('public.supplier_users') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.supplier_users; stop and reconcile the export'; END IF;
  IF to_regclass('public.suppliers') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.suppliers; stop and reconcile the export'; END IF;
  IF to_regclass('public.technical_inspections') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.technical_inspections; stop and reconcile the export'; END IF;
  IF to_regclass('public.ui_resource_permissions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.ui_resource_permissions; stop and reconcile the export'; END IF;
  IF to_regclass('public.user_data_scopes') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.user_data_scopes; stop and reconcile the export'; END IF;
  IF to_regclass('public.user_permissions') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.user_permissions; stop and reconcile the export'; END IF;
  IF to_regclass('public.user_registration_requests') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.user_registration_requests; stop and reconcile the export'; END IF;
  IF to_regclass('public.users') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.users; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_item_batches') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_item_batches; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_replenishment_policies') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_replenishment_policies; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_replenishment_tasks') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_replenishment_tasks; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_stock_levels') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_stock_levels; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_stock_movements') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_stock_movements; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_supplied_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_supplied_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_supply_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_supply_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_supply_templates') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_supply_templates; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_transfer_items') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_transfer_items; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouse_transfer_requests') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouse_transfer_requests; stop and reconcile the export'; END IF;
  IF to_regclass('public.warehouses') IS NULL THEN RAISE EXCEPTION 'Base snapshot table missing: public.warehouses; stop and reconcile the export'; END IF;
END $preflight$;

-- Stop before defaults/NOT NULL fields could invent historical values on partial installs.
DO $partial_preflight$ DECLARE candidate record; populated boolean; BEGIN
  FOR candidate IN SELECT required.table_name,required.column_name FROM (VALUES
    ('ai_interactions','id'),
    ('ai_interactions','user_id'),
    ('ai_interactions','institute_id'),
    ('ai_interactions','session_id'),
    ('ai_interactions','feature'),
    ('ai_interactions','status'),
    ('ai_interactions','metadata'),
    ('ai_interactions','started_at'),
    ('ai_interactions','created_at'),
    ('ai_tool_executions','id'),
    ('ai_tool_executions','interaction_id'),
    ('ai_tool_executions','tool_name'),
    ('ai_tool_executions','parameters'),
    ('ai_tool_executions','result_metadata'),
    ('ai_tool_executions','execution_time_ms'),
    ('ai_tool_executions','success'),
    ('ai_tool_executions','created_at'),
    ('approval_authority_delegations','id'),
    ('approval_authority_delegations','institute_id'),
    ('approval_authority_delegations','delegate_user_id'),
    ('approval_authority_delegations','effective_from'),
    ('approval_authority_delegations','effective_to'),
    ('approval_authority_delegations','scope'),
    ('approval_authority_delegations','reason'),
    ('approval_authority_delegations','status'),
    ('approval_authority_delegations','created_by'),
    ('approval_authority_delegations','created_at'),
    ('approval_authority_delegations','row_version'),
    ('approval_authority_delegations','authority_kind'),
    ('approval_policies','id'),
    ('approval_policies','institute_id'),
    ('approval_policies','code'),
    ('approval_policies','name'),
    ('approval_policies','request_scope'),
    ('approval_policies','is_active'),
    ('approval_policies','created_at'),
    ('approval_policies','updated_at'),
    ('approval_policy_rule_conditions','id'),
    ('approval_policy_rule_conditions','policy_rule_id'),
    ('approval_policy_rule_conditions','condition_group'),
    ('approval_policy_rule_conditions','condition_type'),
    ('approval_policy_rule_conditions','condition_value'),
    ('approval_policy_rule_conditions','created_at'),
    ('approval_policy_rule_steps','id'),
    ('approval_policy_rule_steps','policy_rule_id'),
    ('approval_policy_rule_steps','step_order'),
    ('approval_policy_rule_steps','approval_level'),
    ('approval_policy_rule_steps','resolver_type'),
    ('approval_policy_rule_steps','required'),
    ('approval_policy_rule_steps','semantic_key'),
    ('approval_policy_rule_steps','display_name'),
    ('approval_policy_rule_steps','created_at'),
    ('approval_policy_rules','id'),
    ('approval_policy_rules','policy_version_id'),
    ('approval_policy_rules','rule_code'),
    ('approval_policy_rules','name'),
    ('approval_policy_rules','priority'),
    ('approval_policy_rules','is_active'),
    ('approval_policy_rules','stop_processing'),
    ('approval_policy_rules','created_at'),
    ('approval_policy_shadow_differences','id'),
    ('approval_policy_shadow_differences','shadow_run_id'),
    ('approval_policy_shadow_differences','difference_type'),
    ('approval_policy_shadow_differences','details'),
    ('approval_policy_shadow_differences','created_at'),
    ('approval_policy_shadow_runs','id'),
    ('approval_policy_shadow_runs','request_id'),
    ('approval_policy_shadow_runs','policy_version_id'),
    ('approval_policy_shadow_runs','run_status'),
    ('approval_policy_shadow_runs','generated_at'),
    ('approval_policy_shadow_runs','facts_snapshot'),
    ('approval_policy_shadow_runs','summary'),
    ('approval_policy_shadow_runs','created_at'),
    ('approval_policy_shadow_steps','id'),
    ('approval_policy_shadow_steps','shadow_run_id'),
    ('approval_policy_shadow_steps','sequence'),
    ('approval_policy_shadow_steps','approval_level'),
    ('approval_policy_shadow_steps','semantic_key'),
    ('approval_policy_shadow_steps','resolver_type'),
    ('approval_policy_shadow_steps','resolution_status'),
    ('approval_policy_shadow_steps','created_at'),
    ('approval_policy_versions','id'),
    ('approval_policy_versions','approval_policy_id'),
    ('approval_policy_versions','version_number'),
    ('approval_policy_versions','status'),
    ('approval_policy_versions','created_at'),
    ('approval_route_snapshot_steps','id'),
    ('approval_route_snapshot_steps','snapshot_id'),
    ('approval_route_snapshot_steps','sequence'),
    ('approval_route_snapshot_steps','approval_level'),
    ('approval_route_snapshot_steps','semantic_key'),
    ('approval_route_snapshot_steps','required_authority'),
    ('approval_route_snapshot_steps','resolution_type'),
    ('approval_route_snapshot_steps','generated_at'),
    ('approval_route_snapshot_steps','row_version'),
    ('approval_route_snapshots','id'),
    ('approval_route_snapshots','institute_id'),
    ('approval_route_snapshots','request_id'),
    ('approval_route_snapshots','policy_id'),
    ('approval_route_snapshots','policy_version_id'),
    ('approval_route_snapshots','facts_snapshot'),
    ('approval_route_snapshots','route_generation_context'),
    ('approval_route_snapshots','generated_at'),
    ('approval_route_snapshots','row_version'),
    ('approved_products','id'),
    ('approved_products','generic_item_id'),
    ('approved_products','manufacturer'),
    ('approved_products','product_name'),
    ('approved_products','manufacturer_part_number'),
    ('approved_products','normalized_manufacturer_part_number'),
    ('approved_products','technical_specifications'),
    ('approved_products','package_quantity'),
    ('approved_products','product_uom'),
    ('approved_products','inventory_conversion_factor'),
    ('approved_products','regulatory_identifiers'),
    ('approved_products','certifications'),
    ('approved_products','approval_status'),
    ('approved_products','is_preferred'),
    ('approved_products','is_active'),
    ('approved_products','created_at'),
    ('approved_products','updated_at'),
    ('approved_spare_parts','id'),
    ('approved_spare_parts','institute_id'),
    ('approved_spare_parts','spare_part_code'),
    ('approved_spare_parts','name'),
    ('approved_spare_parts','spare_part_type'),
    ('approved_spare_parts','criticality'),
    ('approved_spare_parts','failure_consequence'),
    ('approved_spare_parts','interchangeability_status'),
    ('approved_spare_parts','lifecycle_status'),
    ('approved_spare_parts','is_repairable'),
    ('approved_spare_parts','is_serialized'),
    ('approved_spare_parts','is_consumable'),
    ('approved_spare_parts','is_safety_critical'),
    ('approved_spare_parts','recommended_stocking_policy'),
    ('approved_spare_parts','technical_approval_status'),
    ('approved_spare_parts','created_by'),
    ('approved_spare_parts','created_at'),
    ('approved_spare_parts','updated_by'),
    ('approved_spare_parts','updated_at'),
    ('approved_spare_parts','row_version'),
    ('asset_categories','id'),
    ('asset_categories','institute_id'),
    ('asset_categories','code'),
    ('asset_categories','name'),
    ('asset_categories','is_active'),
    ('asset_categories','created_at'),
    ('asset_categories','updated_at'),
    ('asset_exceptions','id'),
    ('asset_exceptions','institute_id'),
    ('asset_exceptions','exception_type'),
    ('asset_exceptions','severity'),
    ('asset_exceptions','status'),
    ('asset_exceptions','detected_at'),
    ('asset_exceptions','created_at'),
    ('asset_inventory_discoveries','id'),
    ('asset_inventory_discoveries','institute_id'),
    ('asset_inventory_discoveries','session_id'),
    ('asset_inventory_discoveries','description'),
    ('asset_inventory_discoveries','evidence'),
    ('asset_inventory_discoveries','discovered_by'),
    ('asset_inventory_discoveries','discovered_at'),
    ('asset_inventory_expected_assets','id'),
    ('asset_inventory_expected_assets','institute_id'),
    ('asset_inventory_expected_assets','session_id'),
    ('asset_inventory_expected_assets','asset_id'),
    ('asset_inventory_expected_assets','asset_number_snapshot'),
    ('asset_inventory_expected_assets','description_snapshot'),
    ('asset_inventory_expected_assets','operational_status_snapshot'),
    ('asset_inventory_expected_assets','condition_snapshot'),
    ('asset_inventory_expected_assets','snapshot_at'),
    ('asset_inventory_findings','id'),
    ('asset_inventory_findings','institute_id'),
    ('asset_inventory_findings','session_id'),
    ('asset_inventory_findings','finding_type'),
    ('asset_inventory_findings','severity'),
    ('asset_inventory_findings','status'),
    ('asset_inventory_findings','context'),
    ('asset_inventory_findings','created_at'),
    ('asset_inventory_findings','created_by'),
    ('asset_inventory_number_allocators','institute_id'),
    ('asset_inventory_number_allocators','next_value'),
    ('asset_inventory_number_allocators','prefix'),
    ('asset_inventory_observations','id'),
    ('asset_inventory_observations','institute_id'),
    ('asset_inventory_observations','session_id'),
    ('asset_inventory_observations','observed_identifier'),
    ('asset_inventory_observations','observation_method'),
    ('asset_inventory_observations','observed_at'),
    ('asset_inventory_observations','observed_by'),
    ('asset_inventory_observations','raw_evidence'),
    ('asset_inventory_observations','dedupe_key'),
    ('asset_inventory_observations','created_at'),
    ('asset_inventory_resolutions','id'),
    ('asset_inventory_resolutions','institute_id'),
    ('asset_inventory_resolutions','finding_id'),
    ('asset_inventory_resolutions','from_status'),
    ('asset_inventory_resolutions','to_status'),
    ('asset_inventory_resolutions','resolution_notes'),
    ('asset_inventory_resolutions','created_at'),
    ('asset_inventory_resolutions','created_by'),
    ('asset_inventory_sessions','id'),
    ('asset_inventory_sessions','institute_id'),
    ('asset_inventory_sessions','session_number'),
    ('asset_inventory_sessions','name'),
    ('asset_inventory_sessions','scope_type'),
    ('asset_inventory_sessions','include_descendants'),
    ('asset_inventory_sessions','status'),
    ('asset_inventory_sessions','created_at'),
    ('asset_inventory_sessions','created_by'),
    ('asset_inventory_sessions','updated_at'),
    ('asset_inventory_sessions','updated_by'),
    ('asset_inventory_sessions','row_version'),
    ('asset_locations','id'),
    ('asset_locations','institute_id'),
    ('asset_locations','code'),
    ('asset_locations','name'),
    ('asset_locations','location_type'),
    ('asset_locations','is_active'),
    ('asset_locations','created_at'),
    ('asset_locations','updated_at'),
    ('asset_movements','id'),
    ('asset_movements','institute_id'),
    ('asset_movements','asset_id'),
    ('asset_movements','movement_type'),
    ('asset_movements','requested_by'),
    ('asset_movements','requested_at'),
    ('asset_movements','reason'),
    ('asset_movements','status'),
    ('asset_movements','created_at'),
    ('asset_movements','updated_at'),
    ('asset_number_allocators','institute_id'),
    ('asset_number_allocators','next_value'),
    ('asset_number_allocators','prefix'),
    ('asset_tags','id'),
    ('asset_tags','institute_id'),
    ('asset_tags','asset_id'),
    ('asset_tags','tag_type'),
    ('asset_tags','tag_status'),
    ('asset_tags','is_primary'),
    ('asset_tags','created_at'),
    ('asset_tags','updated_at'),
    ('assets','id'),
    ('assets','institute_id'),
    ('assets','asset_number'),
    ('assets','asset_class'),
    ('assets','asset_category_id'),
    ('assets','description'),
    ('assets','acquisition_method'),
    ('assets','capitalization_status'),
    ('assets','ownership_type'),
    ('assets','condition'),
    ('assets','operational_status'),
    ('assets','reconciliation_status'),
    ('assets','creation_source'),
    ('assets','is_active'),
    ('assets','created_at'),
    ('assets','updated_at'),
    ('assets','row_version'),
    ('contract_ai_extractions','id'),
    ('contract_ai_extractions','contract_id'),
    ('contract_ai_extractions','extraction_status'),
    ('contract_ai_extractions','extracted_parties'),
    ('contract_ai_extractions','extracted_dates'),
    ('contract_ai_extractions','extracted_value'),
    ('contract_ai_extractions','extracted_payment_terms'),
    ('contract_ai_extractions','extracted_renewal_clause'),
    ('contract_ai_extractions','extracted_termination_clause'),
    ('contract_ai_extractions','extracted_obligations'),
    ('contract_ai_extractions','extracted_risks'),
    ('contract_ai_extractions','raw_json'),
    ('contract_ai_extractions','created_at'),
    ('contract_ai_extractions','updated_at'),
    ('contract_alerts','id'),
    ('contract_alerts','contract_id'),
    ('contract_alerts','alert_type'),
    ('contract_alerts','is_active'),
    ('contract_alerts','created_at'),
    ('contract_amendments','id'),
    ('contract_amendments','contract_id'),
    ('contract_amendments','amendment_number'),
    ('contract_amendments','created_at'),
    ('contract_approvals','id'),
    ('contract_approvals','contract_id'),
    ('contract_approvals','workflow_level'),
    ('contract_approvals','is_active_level'),
    ('contract_approvals','stage'),
    ('contract_approvals','assigned_at'),
    ('contract_approvals','created_at'),
    ('contract_approvals','updated_at'),
    ('contract_approvals','approval_level'),
    ('contract_approvals','status'),
    ('contract_approvals','is_active'),
    ('contract_approvals','review_sections'),
    ('contract_clause_assignments','id'),
    ('contract_clause_assignments','contract_id'),
    ('contract_clause_assignments','clause_id'),
    ('contract_clause_assignments','sort_order'),
    ('contract_clause_assignments','created_at'),
    ('contract_clauses','id'),
    ('contract_clauses','clause_title'),
    ('contract_clauses','clause_content'),
    ('contract_clauses','clause_version'),
    ('contract_clauses','is_active'),
    ('contract_clauses','created_at'),
    ('contract_clauses','updated_at'),
    ('contract_consumption','id'),
    ('contract_consumption','contract_id'),
    ('contract_consumption','source_type'),
    ('contract_consumption','consumption_date'),
    ('contract_consumption','amount'),
    ('contract_consumption','currency'),
    ('contract_consumption','created_at'),
    ('contract_document_versions','id'),
    ('contract_document_versions','document_id'),
    ('contract_document_versions','contract_id'),
    ('contract_document_versions','version_number'),
    ('contract_document_versions','uploaded_at'),
    ('contract_document_versions','is_current'),
    ('contract_documents','id'),
    ('contract_documents','contract_id'),
    ('contract_documents','document_type'),
    ('contract_documents','status'),
    ('contract_documents','created_at'),
    ('contract_documents','updated_at'),
    ('contract_equipment_coverage','id'),
    ('contract_equipment_coverage','institute_id'),
    ('contract_equipment_coverage','contract_id'),
    ('contract_equipment_coverage','equipment_id'),
    ('contract_equipment_coverage','coverage_type'),
    ('contract_equipment_coverage','coverage_start'),
    ('contract_equipment_coverage','coverage_end'),
    ('contract_equipment_coverage','pm_included'),
    ('contract_equipment_coverage','corrective_included'),
    ('contract_equipment_coverage','labor_included'),
    ('contract_equipment_coverage','parts_included'),
    ('contract_equipment_coverage','consumables_included'),
    ('contract_equipment_coverage','travel_included'),
    ('contract_equipment_coverage','software_included'),
    ('contract_equipment_coverage','calibration_included'),
    ('contract_equipment_coverage','created_by'),
    ('contract_equipment_coverage','created_at'),
    ('contract_equipment_coverage','updated_by'),
    ('contract_equipment_coverage','updated_at'),
    ('contract_invoices','id'),
    ('contract_invoices','amount'),
    ('contract_invoices','currency'),
    ('contract_invoices','tax_amount'),
    ('contract_invoices','discount_amount'),
    ('contract_invoices','retention_amount'),
    ('contract_invoices','penalty_amount'),
    ('contract_invoices','net_payable_amount'),
    ('contract_invoices','status'),
    ('contract_invoices','matching_status'),
    ('contract_invoices','matching_flags'),
    ('contract_invoices','created_at'),
    ('contract_invoices','updated_at'),
    ('contract_items','id'),
    ('contract_items','contract_id'),
    ('contract_items','item_name'),
    ('contract_items','delivered_quantity'),
    ('contract_items','is_active'),
    ('contract_items','created_at'),
    ('contract_items','updated_at'),
    ('contract_legal_reviews','id'),
    ('contract_legal_reviews','contract_id'),
    ('contract_logs','id'),
    ('contract_logs','contract_id'),
    ('contract_logs','action'),
    ('contract_logs','created_at'),
    ('contract_negotiations','id'),
    ('contract_negotiations','contract_id'),
    ('contract_negotiations','negotiation_round'),
    ('contract_negotiations','created_at'),
    ('contract_obligations','id'),
    ('contract_obligations','contract_id'),
    ('contract_obligations','obligation_type'),
    ('contract_obligations','title'),
    ('contract_obligations','status'),
    ('contract_obligations','created_at'),
    ('contract_obligations','updated_at'),
    ('contract_obligations','recurrence'),
    ('contract_obligations','evidence_required'),
    ('contract_obligations','priority'),
    ('contract_payments','id'),
    ('contract_payments','amount'),
    ('contract_payments','currency'),
    ('contract_payments','created_at'),
    ('contract_payments','status'),
    ('contract_payments','updated_at'),
    ('contract_renewal_events','id'),
    ('contract_renewal_events','contract_id'),
    ('contract_renewal_events','notice_days'),
    ('contract_renewal_events','status'),
    ('contract_renewal_events','created_at'),
    ('contract_renewal_events','updated_at'),
    ('contract_required_documents','id'),
    ('contract_required_documents','contract_id'),
    ('contract_required_documents','document_type'),
    ('contract_required_documents','is_uploaded'),
    ('contract_required_documents','created_at'),
    ('contract_required_documents','updated_at'),
    ('contract_risk_assessments','id'),
    ('contract_risk_assessments','contract_id'),
    ('contract_risk_assessments','risk_score'),
    ('contract_risk_assessments','risk_level'),
    ('contract_risk_assessments','risk_factors'),
    ('contract_risk_assessments','assessed_at'),
    ('contract_risk_assessments','assessment_source'),
    ('contract_risk_assessments','created_at'),
    ('contract_sla_events','id'),
    ('contract_sla_events','contract_id'),
    ('contract_sla_events','breached'),
    ('contract_sla_events','created_at'),
    ('contract_templates','id'),
    ('contract_templates','template_name'),
    ('contract_templates','is_active'),
    ('contract_templates','created_at'),
    ('contract_templates','updated_at'),
    ('contract_versions','id'),
    ('contract_versions','contract_id'),
    ('contract_versions','version_number'),
    ('contract_versions','snapshot'),
    ('contract_versions','created_at'),
    ('department_item_follow_up_notes','id'),
    ('department_item_follow_up_notes','department_id'),
    ('department_item_follow_up_notes','note'),
    ('department_item_follow_up_notes','created_at'),
    ('department_priority_rankings','id'),
    ('department_priority_rankings','procurement_case_id'),
    ('department_priority_rankings','institute_id'),
    ('department_priority_rankings','department_id'),
    ('department_priority_rankings','department_rank'),
    ('department_priority_rankings','department_rank_total'),
    ('department_priority_rankings','ranked_by'),
    ('department_priority_rankings','ranked_at'),
    ('document_branding_settings','key'),
    ('document_branding_settings','updated_at'),
    ('employee_tasks','id'),
    ('employee_tasks','title'),
    ('employee_tasks','assigned_to'),
    ('employee_tasks','assigned_by'),
    ('employee_tasks','status'),
    ('employee_tasks','assigned_at'),
    ('employee_tasks','updated_at'),
    ('generic_item_merges','id'),
    ('generic_item_merges','source_generic_item_id'),
    ('generic_item_merges','target_generic_item_id'),
    ('generic_item_merges','status'),
    ('generic_item_merges','merge_reason'),
    ('generic_item_merges','conflict_details'),
    ('generic_item_merges','reviewed_by'),
    ('generic_item_merges','created_at'),
    ('generic_items','id'),
    ('generic_items','item_code'),
    ('generic_items','generic_name'),
    ('generic_items','canonical_description'),
    ('generic_items','category'),
    ('generic_items','item_type'),
    ('generic_items','specification'),
    ('generic_items','base_uom'),
    ('generic_items','inventory_uom'),
    ('generic_items','conversion_rules'),
    ('generic_items','storage_requirements'),
    ('generic_items','criticality'),
    ('generic_items','hazard_information'),
    ('generic_items','is_sterile'),
    ('generic_items','expiry_controlled'),
    ('generic_items','batch_controlled'),
    ('generic_items','serial_controlled'),
    ('generic_items','lifecycle_status'),
    ('generic_items','standardization_status'),
    ('generic_items','interchangeability_policy'),
    ('generic_items','is_proprietary'),
    ('generic_items','is_active'),
    ('generic_items','structured_fingerprint'),
    ('generic_items','created_at'),
    ('generic_items','updated_at'),
    ('inventory_cycle_count_lines','id'),
    ('inventory_cycle_count_lines','cycle_count_id'),
    ('inventory_cycle_count_lines','stock_item_id'),
    ('inventory_cycle_count_lines','system_quantity'),
    ('inventory_cycle_counts','id'),
    ('inventory_cycle_counts','warehouse_id'),
    ('inventory_cycle_counts','status'),
    ('inventory_cycle_counts','opened_by'),
    ('inventory_cycle_counts','created_at'),
    ('inventory_reservation_allocations','id'),
    ('inventory_reservation_allocations','reservation_id'),
    ('inventory_reservation_allocations','warehouse_stock_level_id'),
    ('inventory_reservation_allocations','reserved_quantity'),
    ('inventory_reservation_allocations','consumed_quantity'),
    ('inventory_reservation_allocations','released_quantity'),
    ('inventory_reservation_allocations','created_at'),
    ('inventory_reservation_allocations','updated_at'),
    ('inventory_reservation_issue_operations','id'),
    ('inventory_reservation_issue_operations','reservation_id'),
    ('inventory_reservation_issue_operations','idempotency_key'),
    ('inventory_reservation_issue_operations','requested_quantity'),
    ('inventory_reservation_issue_operations','inventory_movement_id'),
    ('inventory_reservation_issue_operations','created_by'),
    ('inventory_reservation_issue_operations','created_at'),
    ('inventory_reservations','id'),
    ('inventory_reservations','warehouse_id'),
    ('inventory_reservations','stock_item_id'),
    ('inventory_reservations','document_type'),
    ('inventory_reservations','document_id'),
    ('inventory_reservations','quantity'),
    ('inventory_reservations','status'),
    ('inventory_reservations','idempotency_key'),
    ('inventory_reservations','created_by'),
    ('inventory_reservations','metadata'),
    ('inventory_reservations','created_at'),
    ('inventory_reservations','consumed_quantity'),
    ('inventory_transaction_allocations','id'),
    ('inventory_transaction_allocations','inventory_transaction_id'),
    ('inventory_transaction_allocations','warehouse_id'),
    ('inventory_transaction_allocations','stock_item_id'),
    ('inventory_transaction_allocations','stock_status'),
    ('inventory_transaction_allocations','quantity'),
    ('inventory_transaction_allocations','base_uom'),
    ('inventory_transaction_allocations','allocation_sequence'),
    ('inventory_transaction_allocations','created_at'),
    ('inventory_transfer_allocation_links','id'),
    ('inventory_transfer_allocation_links','transfer_id'),
    ('inventory_transfer_allocation_links','transfer_line_id'),
    ('inventory_transfer_allocation_links','dispatch_movement_id'),
    ('inventory_transfer_allocation_links','dispatch_allocation_id'),
    ('inventory_transfer_allocation_links','dispatched_quantity'),
    ('inventory_transfer_allocation_links','received_quantity'),
    ('inventory_transfer_allocation_links','created_at'),
    ('inventory_transfer_allocation_links','updated_at'),
    ('inventory_transfer_movement_links','id'),
    ('inventory_transfer_movement_links','transfer_id'),
    ('inventory_transfer_movement_links','transfer_line_id'),
    ('inventory_transfer_movement_links','dispatch_movement_id'),
    ('inventory_transfer_movement_links','receipt_movement_ids'),
    ('inventory_transfer_movement_links','dispatched_quantity'),
    ('inventory_transfer_movement_links','received_quantity'),
    ('inventory_transfer_movement_links','created_at'),
    ('inventory_transfer_movement_links','updated_at'),
    ('inventory_transfer_receipt_operations','id'),
    ('inventory_transfer_receipt_operations','transfer_id'),
    ('inventory_transfer_receipt_operations','idempotency_key'),
    ('inventory_transfer_receipt_operations','receipt_movement_ids'),
    ('inventory_transfer_receipt_operations','created_by'),
    ('inventory_transfer_receipt_operations','created_at'),
    ('invoice_match_override_decisions','id'),
    ('invoice_match_override_decisions','invoice_match_result_id'),
    ('invoice_match_override_decisions','decision'),
    ('invoice_match_override_decisions','reason'),
    ('invoice_match_override_decisions','actor_id'),
    ('invoice_match_override_decisions','original_variances'),
    ('invoice_match_override_decisions','decided_at'),
    ('item_duplicate_reviews','id'),
    ('item_duplicate_reviews','entity_type'),
    ('item_duplicate_reviews','source_id'),
    ('item_duplicate_reviews','candidate_id'),
    ('item_duplicate_reviews','score'),
    ('item_duplicate_reviews','matching_attributes'),
    ('item_duplicate_reviews','decision'),
    ('item_duplicate_reviews','created_at'),
    ('item_master_aliases','id'),
    ('item_master_aliases','generic_item_id'),
    ('item_master_aliases','alias_type'),
    ('item_master_aliases','alias_value'),
    ('item_master_aliases','normalized_alias'),
    ('item_master_aliases','created_at'),
    ('item_master_audit_events','id'),
    ('item_master_audit_events','entity_type'),
    ('item_master_audit_events','action'),
    ('item_master_audit_events','organizational_context'),
    ('item_master_audit_events','created_at'),
    ('journal_entries','id'),
    ('journal_entries','journal_type'),
    ('journal_entries','source_type'),
    ('journal_entries','journal_reference'),
    ('journal_entries','entry_status'),
    ('journal_entries','currency'),
    ('journal_entries','total_amount'),
    ('journal_entries','posted_at'),
    ('journal_entries','created_at'),
    ('journal_entry_lines','id'),
    ('journal_entry_lines','journal_entry_id'),
    ('journal_entry_lines','line_no'),
    ('journal_entry_lines','account_code'),
    ('journal_entry_lines','debit_amount'),
    ('journal_entry_lines','credit_amount'),
    ('journal_entry_lines','created_at'),
    ('legacy_item_mappings','id'),
    ('legacy_item_mappings','source_table'),
    ('legacy_item_mappings','legacy_item_id'),
    ('legacy_item_mappings','generic_item_id'),
    ('legacy_item_mappings','legacy_name_snapshot'),
    ('legacy_item_mappings','mapping_status'),
    ('legacy_item_mappings','mapping_reason'),
    ('legacy_item_mappings','mapped_by'),
    ('legacy_item_mappings','mapped_at'),
    ('maintainable_equipment','id'),
    ('maintainable_equipment','institute_id'),
    ('maintainable_equipment','equipment_code'),
    ('maintainable_equipment','name'),
    ('maintainable_equipment','manufacturer'),
    ('maintainable_equipment','model'),
    ('maintainable_equipment','lifecycle_status'),
    ('maintainable_equipment','created_at'),
    ('maintainable_equipment','updated_at'),
    ('maintenance_part_inventory_operations','id'),
    ('maintenance_part_inventory_operations','institute_id'),
    ('maintenance_part_inventory_operations','work_order_part_id'),
    ('maintenance_part_inventory_operations','operation_type'),
    ('maintenance_part_inventory_operations','quantity'),
    ('maintenance_part_inventory_operations','idempotency_key'),
    ('maintenance_part_inventory_operations','created_by'),
    ('maintenance_part_inventory_operations','created_at'),
    ('maintenance_work_order_allocators','institute_id'),
    ('maintenance_work_order_allocators','next_value'),
    ('maintenance_work_order_parts','id'),
    ('maintenance_work_order_parts','institute_id'),
    ('maintenance_work_order_parts','work_order_id'),
    ('maintenance_work_order_parts','spare_part_id'),
    ('maintenance_work_order_parts','stock_item_id'),
    ('maintenance_work_order_parts','quantity_planned'),
    ('maintenance_work_order_parts','quantity_used'),
    ('maintenance_work_order_parts','action'),
    ('maintenance_work_order_parts','created_by'),
    ('maintenance_work_order_parts','created_at'),
    ('maintenance_work_order_parts','updated_at'),
    ('maintenance_work_orders','id'),
    ('maintenance_work_orders','institute_id'),
    ('maintenance_work_orders','work_order_number'),
    ('maintenance_work_orders','equipment_id'),
    ('maintenance_work_orders','work_order_type'),
    ('maintenance_work_orders','priority'),
    ('maintenance_work_orders','status'),
    ('maintenance_work_orders','problem_description'),
    ('maintenance_work_orders','requested_at'),
    ('maintenance_work_orders','created_by'),
    ('maintenance_work_orders','created_at'),
    ('maintenance_work_orders','updated_by'),
    ('maintenance_work_orders','updated_at'),
    ('maintenance_work_orders','row_version'),
    ('notification_outbox','id'),
    ('notification_outbox','event_type'),
    ('notification_outbox','entity_type'),
    ('notification_outbox','entity_id'),
    ('notification_outbox','payload'),
    ('notification_outbox','idempotency_key'),
    ('notification_outbox','status'),
    ('notification_outbox','retry_count'),
    ('notification_outbox','next_attempt_at'),
    ('notification_outbox','created_at'),
    ('organization_head_reconciliation_decisions','id'),
    ('organization_head_reconciliation_decisions','institute_id'),
    ('organization_head_reconciliation_decisions','organization_unit_id'),
    ('organization_head_reconciliation_decisions','organization_head_position_id'),
    ('organization_head_reconciliation_decisions','organization_head_user_id'),
    ('organization_head_reconciliation_decisions','decision'),
    ('organization_head_reconciliation_decisions','reason'),
    ('organization_head_reconciliation_decisions','decided_by'),
    ('organization_head_reconciliation_decisions','decided_at'),
    ('organization_positions','id'),
    ('organization_positions','organization_unit_id'),
    ('organization_positions','position_type'),
    ('organization_positions','position_name'),
    ('organization_positions','is_unit_head'),
    ('organization_positions','is_active'),
    ('organization_positions','created_at'),
    ('organization_positions','updated_at'),
    ('organization_units','id'),
    ('organization_units','institute_id'),
    ('organization_units','name'),
    ('organization_units','unit_type'),
    ('organization_units','is_active'),
    ('organization_units','sort_order'),
    ('organization_units','created_at'),
    ('organization_units','updated_at'),
    ('pending_item_requests','id'),
    ('pending_item_requests','proposed_name'),
    ('pending_item_requests','item_type'),
    ('pending_item_requests','required_specifications'),
    ('pending_item_requests','intended_use'),
    ('pending_item_requests','justification'),
    ('pending_item_requests','status'),
    ('pending_item_requests','requester_id'),
    ('pending_item_requests','created_at'),
    ('pending_item_requests','updated_at'),
    ('planning_settings','id'),
    ('planning_settings','forecast_horizon_months'),
    ('planning_settings','forecast_window_size'),
    ('planning_settings','safety_lead_time_days'),
    ('planning_settings','safety_review_period_days'),
    ('planning_settings','demand_history_days'),
    ('planning_settings','demand_history_months'),
    ('planning_settings','safety_history_days'),
    ('planning_settings','mrp_horizon_days'),
    ('planning_settings','mrp_bucket_days'),
    ('planning_settings','created_at'),
    ('planning_settings','updated_at'),
    ('print_service_requests','id'),
    ('print_service_requests','requester_id'),
    ('print_service_requests','form_name'),
    ('print_service_requests','quantity'),
    ('print_service_requests','status'),
    ('print_service_requests','created_at'),
    ('print_service_requests','updated_at'),
    ('print_service_settings','key'),
    ('print_service_settings','updated_at'),
    ('procurement_awards','id'),
    ('procurement_awards','request_id'),
    ('procurement_awards','request_item_id'),
    ('procurement_awards','supplier_id'),
    ('procurement_awards','awarded_quantity'),
    ('procurement_awards','unit_price'),
    ('procurement_awards','currency'),
    ('procurement_awards','source_type'),
    ('procurement_awards','selection_reason'),
    ('procurement_awards','awarded_at'),
    ('procurement_awards','status'),
    ('procurement_awards','idempotency_key'),
    ('procurement_awards','payload_fingerprint'),
    ('procurement_case_activities','id'),
    ('procurement_case_activities','procurement_case_id'),
    ('procurement_case_activities','activity_type'),
    ('procurement_case_activities','activity_at'),
    ('procurement_case_activities','source'),
    ('procurement_case_activities','metadata'),
    ('procurement_case_activities','created_at'),
    ('procurement_case_complexity_factors','id'),
    ('procurement_case_complexity_factors','procurement_case_id'),
    ('procurement_case_complexity_factors','model_version'),
    ('procurement_case_complexity_factors','factor_code'),
    ('procurement_case_complexity_factors','factor_value'),
    ('procurement_case_complexity_factors','points'),
    ('procurement_case_complexity_factors','assessed_at'),
    ('procurement_case_complexity_factors','assessed_by'),
    ('procurement_case_complexity_factors','assessment_reason'),
    ('procurement_cases','id'),
    ('procurement_cases','request_id'),
    ('procurement_cases','requested_item_id'),
    ('procurement_cases','institute_id'),
    ('procurement_cases','case_status'),
    ('procurement_cases','opened_at'),
    ('procurement_cases','strategic_highlight'),
    ('procurement_cases','activity_coverage'),
    ('procurement_cases','complexity_coverage'),
    ('procurement_cases','commercial_coverage'),
    ('procurement_cases','cycle_time_coverage'),
    ('procurement_cases','logistics_coverage'),
    ('procurement_cases','created_at'),
    ('procurement_cases','updated_at'),
    ('procurement_evaluation_cases','id'),
    ('procurement_evaluation_cases','evaluation_period_years'),
    ('procurement_evaluation_cases','expected_annual_growth_rate'),
    ('procurement_evaluation_cases','status'),
    ('procurement_evaluation_cases','created_at'),
    ('procurement_evaluation_cases','updated_at'),
    ('procurement_evaluation_criteria','id'),
    ('procurement_evaluation_criteria','weight'),
    ('procurement_evaluation_criteria','higher_is_better'),
    ('procurement_evaluation_criteria','is_required'),
    ('procurement_evaluation_criteria','target_value'),
    ('procurement_evaluation_criteria','min_value'),
    ('procurement_evaluation_criteria','max_value'),
    ('procurement_evaluation_criteria','is_knockout'),
    ('procurement_evaluation_criteria','required_threshold'),
    ('procurement_evaluation_criteria','created_at'),
    ('procurement_evaluation_criteria','updated_at'),
    ('procurement_evaluation_offer_test_costs','unit_cost'),
    ('procurement_evaluation_offer_test_costs','id'),
    ('procurement_evaluation_offer_test_costs','quantity'),
    ('procurement_evaluation_offer_test_costs','annual_quantity'),
    ('procurement_evaluation_offer_test_costs','kit_price'),
    ('procurement_evaluation_offer_test_costs','tests_per_kit'),
    ('procurement_evaluation_offer_test_costs','usable_tests_per_kit'),
    ('procurement_evaluation_offer_test_costs','open_vial_stability_days'),
    ('procurement_evaluation_offer_test_costs','onboard_stability_days'),
    ('procurement_evaluation_offer_test_costs','shelf_life_months'),
    ('procurement_evaluation_offer_test_costs','expected_waste_percentage'),
    ('procurement_evaluation_offer_test_costs','repeat_rate_percentage'),
    ('procurement_evaluation_offer_test_costs','qc_frequency_per_kit'),
    ('procurement_evaluation_offer_test_costs','qc_cost_per_kit'),
    ('procurement_evaluation_offer_test_costs','calibrator_frequency_per_kit'),
    ('procurement_evaluation_offer_test_costs','calibrator_cost_per_kit'),
    ('procurement_evaluation_offer_test_costs','fixed_consumable_cost_per_kit'),
    ('procurement_evaluation_offer_test_costs','other_kit_related_cost'),
    ('procurement_evaluation_offer_test_costs','price_per_reportable_test'),
    ('procurement_evaluation_offer_test_costs','company_absorbs_waste'),
    ('procurement_evaluation_offer_test_costs','company_absorbs_qc'),
    ('procurement_evaluation_offer_test_costs','company_absorbs_repeats'),
    ('procurement_evaluation_offer_test_costs','calculated_effective_cost_per_reported_test'),
    ('procurement_evaluation_offer_test_costs','annual_test_cost'),
    ('procurement_evaluation_offer_test_costs','created_at'),
    ('procurement_evaluation_offer_test_costs','updated_at'),
    ('procurement_evaluation_offers','id'),
    ('procurement_evaluation_offers','is_disqualified'),
    ('procurement_evaluation_offers','lease_monthly_payment'),
    ('procurement_evaluation_offers','lease_term_months'),
    ('procurement_evaluation_offers','subscription_base_fee'),
    ('procurement_evaluation_offers','included_volume'),
    ('procurement_evaluation_offers','overage_price'),
    ('procurement_evaluation_offers','sla_penalty_amount'),
    ('procurement_evaluation_offers','uptime_guarantee_percentage'),
    ('procurement_evaluation_offers','downtime_cost'),
    ('procurement_evaluation_offers','supplier_risk_premium'),
    ('procurement_evaluation_offers','stockout_risk_cost'),
    ('procurement_evaluation_offers','fx_risk_cost'),
    ('procurement_evaluation_offers','obsolescence_risk_cost'),
    ('procurement_evaluation_offers','penalty_or_sla_adjustment'),
    ('procurement_evaluation_offers','device_price'),
    ('procurement_evaluation_offers','installation_cost'),
    ('procurement_evaluation_offers','training_cost'),
    ('procurement_evaluation_offers','shipping_cost'),
    ('procurement_evaluation_offers','customs_cost'),
    ('procurement_evaluation_offers','other_initial_cost'),
    ('procurement_evaluation_offers','device_discount_value'),
    ('procurement_evaluation_offers','warranty_years'),
    ('procurement_evaluation_offers','annual_maintenance_cost'),
    ('procurement_evaluation_offers','annual_service_contract_cost'),
    ('procurement_evaluation_offers','annual_fixed_consumables_cost'),
    ('procurement_evaluation_offers','annual_calibration_qc_cost'),
    ('procurement_evaluation_offers','annual_spare_parts_cost'),
    ('procurement_evaluation_offers','expected_lifetime_years'),
    ('procurement_evaluation_offers','delivery_time_days'),
    ('procurement_evaluation_offers','minimum_annual_commitment_amount'),
    ('procurement_evaluation_offers','minimum_annual_commitment_tests'),
    ('procurement_evaluation_offers','free_device_included'),
    ('procurement_evaluation_offers','technical_model'),
    ('procurement_evaluation_offers','contract_model'),
    ('procurement_evaluation_offers','package_model'),
    ('procurement_evaluation_offers','service_model'),
    ('procurement_evaluation_offers','risk_model'),
    ('procurement_evaluation_offers','scenario_metadata'),
    ('procurement_evaluation_offers','is_compliant'),
    ('procurement_evaluation_offers','created_at'),
    ('procurement_evaluation_offers','updated_at'),
    ('procurement_evaluation_results','initial_cost'),
    ('procurement_evaluation_results','annual_fixed_cost'),
    ('procurement_evaluation_results','annual_variable_test_cost'),
    ('procurement_evaluation_results','annual_commitment_adjustment'),
    ('procurement_evaluation_results','total_annual_cost'),
    ('procurement_evaluation_results','tco_period_cost'),
    ('procurement_evaluation_results','risk_adjusted_tco'),
    ('procurement_evaluation_results','average_cost_per_reported_test'),
    ('procurement_evaluation_results','total_expected_reported_tests'),
    ('procurement_evaluation_results','cost_score'),
    ('procurement_evaluation_results','technical_score'),
    ('procurement_evaluation_results','supplier_score'),
    ('procurement_evaluation_results','risk_score'),
    ('procurement_evaluation_results','final_weighted_score'),
    ('procurement_evaluation_results','commitment_volume_shortfall'),
    ('procurement_evaluation_results','shortfall_tests'),
    ('procurement_evaluation_results','compliance_passed'),
    ('procurement_evaluation_results','knockout_failed'),
    ('procurement_evaluation_results','scoring_breakdown'),
    ('procurement_evaluation_results','id'),
    ('procurement_evaluation_results','created_at'),
    ('procurement_evaluation_results','updated_at'),
    ('procurement_evaluation_scores','id'),
    ('procurement_evaluation_scores','weighted_score'),
    ('procurement_evaluation_scores','raw_value'),
    ('procurement_evaluation_scores','score'),
    ('procurement_evaluation_scores','created_at'),
    ('procurement_evaluation_scores','updated_at'),
    ('procurement_evaluation_tests','id'),
    ('procurement_evaluation_tests','expected_monthly_volume'),
    ('procurement_evaluation_tests','growth_rate'),
    ('procurement_evaluation_tests','is_required'),
    ('procurement_evaluation_tests','is_alternative'),
    ('procurement_evaluation_tests','created_at'),
    ('procurement_evaluation_tests','updated_at'),
    ('procurement_identity_policy','id'),
    ('procurement_identity_policy','enforce_item_identity'),
    ('procurement_identity_policy','reason'),
    ('procurement_identity_policy','updated_at'),
    ('procurement_item_events','id'),
    ('procurement_item_events','request_id'),
    ('procurement_item_events','requested_item_id'),
    ('procurement_item_events','procurement_user_id'),
    ('procurement_item_events','event_quantity'),
    ('procurement_item_events','previous_purchased_quantity'),
    ('procurement_item_events','new_purchased_quantity'),
    ('procurement_item_events','remaining_quantity'),
    ('procurement_item_events','procurement_date'),
    ('procurement_item_events','created_at'),
    ('procurement_priority_group_members','group_id'),
    ('procurement_priority_group_members','procurement_case_id'),
    ('procurement_priority_group_members','added_by'),
    ('procurement_priority_group_members','added_at'),
    ('procurement_priority_groups','id'),
    ('procurement_priority_groups','institute_id'),
    ('procurement_priority_groups','name'),
    ('procurement_priority_groups','is_public'),
    ('procurement_priority_groups','status'),
    ('procurement_priority_groups','created_by'),
    ('procurement_priority_groups','updated_by'),
    ('procurement_priority_groups','created_at'),
    ('procurement_priority_groups','updated_at'),
    ('procurement_priority_history','id'),
    ('procurement_priority_history','procurement_case_id'),
    ('procurement_priority_history','score'),
    ('procurement_priority_history','tier'),
    ('procurement_priority_history','factor_breakdown'),
    ('procurement_priority_history','model_version'),
    ('procurement_priority_history','trigger'),
    ('procurement_priority_history','calculated_at'),
    ('procurement_priority_history','calculated_by_system'),
    ('procurement_priority_profiles','id'),
    ('procurement_priority_profiles','procurement_case_id'),
    ('procurement_priority_profiles','institute_id'),
    ('procurement_priority_profiles','department_id'),
    ('procurement_priority_profiles','coverage_status'),
    ('procurement_priority_profiles','model_version'),
    ('procurement_priority_profiles','is_public'),
    ('procurement_priority_profiles','row_version'),
    ('procurement_priority_profiles','created_at'),
    ('procurement_priority_profiles','updated_at'),
    ('procurement_value_events','id'),
    ('procurement_value_events','procurement_case_id'),
    ('procurement_value_events','value_type'),
    ('procurement_value_events','baseline_type'),
    ('procurement_value_events','verified_value'),
    ('procurement_value_events','currency'),
    ('procurement_value_events','evidence_entity_type'),
    ('procurement_value_events','evidence_entity_id'),
    ('procurement_value_events','entered_by'),
    ('procurement_value_events','created_at'),
    ('project_department_visibility','project_id'),
    ('project_department_visibility','department_id'),
    ('project_department_visibility','created_at'),
    ('request_auto_assignment_rules','id'),
    ('request_auto_assignment_rules','request_type'),
    ('request_auto_assignment_rules','assignee_user_id'),
    ('request_auto_assignment_rules','is_active'),
    ('request_auto_assignment_rules','created_at'),
    ('request_auto_assignment_rules','updated_at'),
    ('request_edit_approvals','id'),
    ('request_edit_approvals','request_id'),
    ('request_edit_approvals','status'),
    ('request_edit_approvals','payload'),
    ('request_edit_approvals','created_at'),
    ('rfid_antennas','id'),
    ('rfid_antennas','institute_id'),
    ('rfid_antennas','reader_id'),
    ('rfid_antennas','antenna_port'),
    ('rfid_antennas','name'),
    ('rfid_antennas','enabled'),
    ('rfid_antennas','configuration'),
    ('rfid_antennas','created_at'),
    ('rfid_antennas','updated_at'),
    ('rfid_business_events','id'),
    ('rfid_business_events','institute_id'),
    ('rfid_business_events','event_type'),
    ('rfid_business_events','epc'),
    ('rfid_business_events','direction'),
    ('rfid_business_events','first_seen_at'),
    ('rfid_business_events','last_seen_at'),
    ('rfid_business_events','observation_count'),
    ('rfid_business_events','authorization_status'),
    ('rfid_business_events','status'),
    ('rfid_business_events','metadata'),
    ('rfid_business_events','created_at'),
    ('rfid_integration_clients','id'),
    ('rfid_integration_clients','institute_id'),
    ('rfid_integration_clients','client_identifier'),
    ('rfid_integration_clients','credential_hash'),
    ('rfid_integration_clients','scopes'),
    ('rfid_integration_clients','enabled'),
    ('rfid_integration_clients','created_at'),
    ('rfid_portal_antennas','portal_id'),
    ('rfid_portal_antennas','antenna_id'),
    ('rfid_portal_antennas','direction_role'),
    ('rfid_portal_antennas','sort_order'),
    ('rfid_portals','id'),
    ('rfid_portals','institute_id'),
    ('rfid_portals','code'),
    ('rfid_portals','name'),
    ('rfid_portals','portal_type'),
    ('rfid_portals','enabled'),
    ('rfid_portals','configuration'),
    ('rfid_portals','created_at'),
    ('rfid_portals','updated_at'),
    ('rfid_read_events','id'),
    ('rfid_read_events','institute_id'),
    ('rfid_read_events','integration_client_id'),
    ('rfid_read_events','epc'),
    ('rfid_read_events','reader_id'),
    ('rfid_read_events','read_timestamp'),
    ('rfid_read_events','source_type'),
    ('rfid_read_events','processing_status'),
    ('rfid_read_events','processing_attempts'),
    ('rfid_read_events','created_at'),
    ('rfid_readers','id'),
    ('rfid_readers','institute_id'),
    ('rfid_readers','code'),
    ('rfid_readers','name'),
    ('rfid_readers','reader_type'),
    ('rfid_readers','device_identifier'),
    ('rfid_readers','status'),
    ('rfid_readers','configuration'),
    ('rfid_readers','is_active'),
    ('rfid_readers','created_at'),
    ('rfid_readers','updated_at'),
    ('rfx_response_items','id'),
    ('rfx_response_items','rfx_response_id'),
    ('rfx_response_items','requested_item_id'),
    ('rfx_response_items','quoted_quantity'),
    ('rfx_response_items','free_quantity'),
    ('rfx_response_items','unit_price'),
    ('rfx_response_items','currency'),
    ('rfx_response_items','created_at'),
    ('route_capability_policies','route_prefix'),
    ('route_capability_policies','module'),
    ('route_capability_policies','resource'),
    ('route_capability_policies','permissions'),
    ('route_capability_policies','updated_at'),
    ('spare_part_equipment_compatibility','id'),
    ('spare_part_equipment_compatibility','spare_part_id'),
    ('spare_part_equipment_compatibility','equipment_id'),
    ('spare_part_equipment_compatibility','compatibility_type'),
    ('spare_part_equipment_compatibility','compatibility_status'),
    ('spare_part_equipment_compatibility','oem_confirmed'),
    ('spare_part_equipment_compatibility','created_by'),
    ('spare_part_equipment_compatibility','created_at'),
    ('spare_part_equipment_compatibility','updated_at'),
    ('stock_item_master_mappings','id'),
    ('stock_item_master_mappings','stock_item_id'),
    ('stock_item_master_mappings','mapping_status'),
    ('stock_item_master_mappings','match_method'),
    ('stock_item_master_mappings','proposed_attributes'),
    ('stock_item_master_mappings','candidate_details'),
    ('stock_item_master_mappings','original_name_snapshot'),
    ('stock_item_master_mappings','created_at'),
    ('stock_item_master_mappings','updated_at'),
    ('stock_item_master_mappings','active'),
    ('stock_item_master_mappings','version'),
    ('stock_item_migration_staging','id'),
    ('stock_item_migration_staging','source_stock_item_id'),
    ('stock_item_migration_staging','source_name'),
    ('stock_item_migration_staging','source_checksum'),
    ('stock_item_migration_staging','import_batch_id'),
    ('stock_item_migration_staging','imported_at'),
    ('stock_item_migration_staging','validation_status'),
    ('stock_item_migration_staging','validation_errors'),
    ('supplier_catalog_items','id'),
    ('supplier_catalog_items','supplier_id'),
    ('supplier_catalog_items','approved_product_id'),
    ('supplier_catalog_items','supplier_item_code'),
    ('supplier_catalog_items','purchasing_uom'),
    ('supplier_catalog_items','conversion_factor'),
    ('supplier_catalog_items','package_size'),
    ('supplier_catalog_items','minimum_order_quantity'),
    ('supplier_catalog_items','order_multiple'),
    ('supplier_catalog_items','availability_status'),
    ('supplier_catalog_items','is_preferred_supplier'),
    ('supplier_catalog_items','is_approved_supplier'),
    ('supplier_catalog_items','is_active'),
    ('supplier_catalog_items','created_at'),
    ('supplier_catalog_items','updated_at'),
    ('supplier_contacts','id'),
    ('supplier_contacts','supplier_id'),
    ('supplier_contacts','name'),
    ('supplier_contacts','is_primary'),
    ('supplier_contacts','created_at'),
    ('supplier_contacts','updated_at'),
    ('supplier_principals','id'),
    ('supplier_principals','supplier_id'),
    ('supplier_principals','principal_name'),
    ('supplier_principals','relationship_type'),
    ('supplier_principals','authorization_status'),
    ('supplier_principals','is_active'),
    ('supplier_principals','created_at'),
    ('supplier_principals','updated_at'),
    ('user_section_assignments','user_id'),
    ('user_section_assignments','section_id')) AS required(table_name,column_name)
    WHERE to_regclass('public.'||required.table_name) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||required.table_name) AND a.attname=required.column_name AND NOT a.attisdropped)
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)',candidate.table_name) INTO populated;
    IF populated THEN RAISE EXCEPTION 'Populated partial module %.% needs explicit data reconciliation before this patch',candidate.table_name,candidate.column_name; END IF;
  END LOOP;
END $partial_preflight$;

-- Source: sql/manual/033_ai_intelligence_foundation.sql
CREATE TABLE IF NOT EXISTS public.ai_interactions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  institute_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/manual/033_ai_intelligence_foundation.sql
CREATE TABLE IF NOT EXISTS public.ai_tool_executions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  interaction_id BIGINT NOT NULL,
  tool_name TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  record_count INTEGER CHECK (record_count IS NULL OR record_count >= 0),
  execution_time_ms INTEGER NOT NULL CHECK (execution_time_ms >= 0),
  success BOOLEAN NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE TABLE IF NOT EXISTS public.approval_authority_delegations (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  organization_position_id BIGINT,
  delegator_user_id INTEGER,
  delegate_user_id INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NOT NULL,
  scope VARCHAR(80) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by INTEGER,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  authority_kind TEXT GENERATED ALWAYS AS (CASE WHEN organization_position_id IS NOT NULL THEN 'POSITION' ELSE 'USER' END) STORED,
  authority_id BIGINT GENERATED ALWAYS AS (COALESCE(organization_position_id,delegator_user_id::bigint)) STORED,
  effective_period TSTZRANGE GENERATED ALWAYS AS (tstzrange(effective_from,effective_to,'[)')) STORED,
  CONSTRAINT approval_delegation_authority_ck CHECK(organization_position_id IS NOT NULL OR delegator_user_id IS NOT NULL),
  CONSTRAINT approval_delegation_self_ck CHECK(delegate_user_id IS DISTINCT FROM delegator_user_id),
  CONSTRAINT approval_delegation_period_ck CHECK(effective_to>effective_from),
  CONSTRAINT approval_delegation_status_ck CHECK(status IN('ACTIVE','REVOKED')),
  CONSTRAINT approval_delegation_row_version_ck CHECK(row_version>0),
  CONSTRAINT approval_delegation_revocation_ck CHECK((status='ACTIVE' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL) OR (status='REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(btrim(revocation_reason))>0)),
  CONSTRAINT approval_delegation_no_overlap_excl EXCLUDE USING gist
   (institute_id WITH =,authority_kind WITH =,authority_id WITH =,scope WITH =,effective_period WITH &&) WHERE (status='ACTIVE')
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policies (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  request_scope VARCHAR(50) NOT NULL DEFAULT 'PURCHASE_REQUEST',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_rule_conditions (
  id BIGSERIAL PRIMARY KEY,
  policy_rule_id BIGINT NOT NULL,
  condition_group INTEGER NOT NULL DEFAULT 1 CHECK(condition_group>0),
  condition_type VARCHAR(60) NOT NULL CHECK(condition_type IN('REQUEST_TYPE_EQUALS','DEPARTMENT_EQUALS','SECTION_EQUALS','DEPARTMENT_CLASSIFICATION_EQUALS','ORGANIZATION_ANCESTOR_EQUALS','AMOUNT_GTE','AMOUNT_LT','IS_STOCK_REQUEST','IS_NON_STOCK_REQUEST','IS_MAINTENANCE_REQUEST','IS_MEDICAL_DEVICE_REQUEST','IS_MEDICAL_REQUEST','WAREHOUSE_REQUIRED')),
  condition_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_rule_steps (
  id BIGSERIAL PRIMARY KEY,
  policy_rule_id BIGINT NOT NULL,
  step_order INTEGER NOT NULL CHECK(step_order>0),
  approval_level INTEGER NOT NULL CHECK(approval_level>0),
  resolver_type VARCHAR(60) NOT NULL CHECK(resolver_type IN('REQUESTER','DEPARTMENT_HEAD','SECTION_HEAD','EXECUTIVE_OWNER','POSITION','CAPABILITY_HOLDER','FIXED_USER','FIXED_AUTHORITY','SUPPLY_CHAIN_AUTHORITY','COO_AUTHORITY','CEO_AUTHORITY','CFO_AUTHORITY','WAREHOUSE_AUTHORITY','MEDICAL_DEVICES_AUTHORITY')),
  resolver_reference TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  parallel_group VARCHAR(100),
  semantic_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(policy_rule_id,step_order,semantic_key,resolver_type)
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_rules (
  id BIGSERIAL PRIMARY KEY,
  policy_version_id BIGINT NOT NULL,
  rule_code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL CHECK(priority>0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  stop_processing BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(policy_version_id,rule_code)
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_shadow_differences (
  id BIGSERIAL PRIMARY KEY,
  shadow_run_id BIGINT NOT NULL,
  difference_type VARCHAR(40) NOT NULL CHECK(difference_type IN('MISSING_IN_SHADOW','ADDED_BY_SHADOW','DIFFERENT_USER','DIFFERENT_LEVEL','DIFFERENT_ORDER','AMBIGUOUS_RESOLUTION','UNRESOLVED_RESOLUTION','DUPLICATE_PRINCIPAL','MATCH')),
  current_step_sequence INTEGER,
  shadow_step_sequence INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_shadow_runs (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  policy_version_id BIGINT NOT NULL,
  existing_route_version TEXT,
  run_status VARCHAR(20) NOT NULL CHECK(run_status IN('MATCH','PARTIAL_MATCH','DIFFERENT','UNRESOLVED','ERROR')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by INTEGER,
  facts_snapshot JSONB NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_shadow_steps (
  id BIGSERIAL PRIMARY KEY,
  shadow_run_id BIGINT NOT NULL,
  sequence INTEGER NOT NULL,
  approval_level INTEGER NOT NULL,
  parallel_group VARCHAR(100),
  semantic_key VARCHAR(100) NOT NULL,
  resolver_type VARCHAR(60) NOT NULL,
  resolver_reference TEXT,
  resolved_user_id INTEGER,
  resolved_user_name VARCHAR(255),
  resolved_unit_id BIGINT,
  resolution_status VARCHAR(20) NOT NULL CHECK(resolution_status IN('RESOLVED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED')),
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shadow_run_id,sequence)
);

-- Source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE TABLE IF NOT EXISTS public.approval_policy_versions (
  id BIGSERIAL PRIMARY KEY,
  approval_policy_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  status VARCHAR(20) NOT NULL CHECK(status IN('DRAFT','VALIDATED','SHADOW','ACTIVE','RETIRED')),
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  validated_at TIMESTAMPTZ,
  validated_by INTEGER,
  activated_at TIMESTAMPTZ,
  activated_by INTEGER,
  CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from)
);

-- Source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE TABLE IF NOT EXISTS public.approval_route_snapshot_steps (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  policy_rule_id BIGINT,
  policy_step_id BIGINT,
  sequence INTEGER NOT NULL,
  approval_level INTEGER NOT NULL,
  parallel_group VARCHAR(100),
  semantic_key VARCHAR(100) NOT NULL,
  required_authority TEXT NOT NULL,
  resolved_unit_id BIGINT,
  resolved_position_id BIGINT,
  structural_holder_id INTEGER,
  acting_approver_id INTEGER,
  delegation_id BIGINT,
  resolution_type VARCHAR(30) NOT NULL,
  resolution_reason TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT approval_snapshot_step_sequence_ck CHECK(sequence>0),
  CONSTRAINT approval_snapshot_step_level_ck CHECK(approval_level>0),
  CONSTRAINT approval_snapshot_step_resolution_ck CHECK(resolution_type IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','DEDUPLICATED','DUPLICATE_PRINCIPAL')),
  CONSTRAINT approval_snapshot_step_row_version_ck CHECK(row_version=1),
  CONSTRAINT approval_snapshot_step_sequence_uq UNIQUE(snapshot_id,sequence)
);

-- Source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE TABLE IF NOT EXISTS public.approval_route_snapshots (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL,
  policy_id BIGINT NOT NULL,
  policy_version_id BIGINT NOT NULL,
  generation_number INTEGER,
  generation_reason TEXT,
  supersedes_snapshot_id BIGINT,
  facts_snapshot JSONB NOT NULL,
  route_generation_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT approval_snapshot_generation_ck CHECK(generation_number>=1),
  CONSTRAINT approval_snapshot_row_version_ck CHECK(row_version=1),
  CONSTRAINT approval_snapshot_generation_uq UNIQUE(request_id,generation_number),
  CONSTRAINT approval_snapshot_supersedes_uq UNIQUE(supersedes_snapshot_id)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.approved_products (
  id BIGSERIAL PRIMARY KEY,
  generic_item_id BIGINT NOT NULL,
  product_identifier TEXT,
  manufacturer TEXT NOT NULL,
  manufacturer_id INTEGER,
  product_name TEXT NOT NULL,
  product_description TEXT,
  manufacturer_part_number TEXT NOT NULL,
  normalized_manufacturer_part_number TEXT NOT NULL,
  model TEXT,
  technical_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  package_configuration TEXT,
  package_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_quantity > 0),
  product_uom TEXT NOT NULL,
  product_uom_id INTEGER,
  inventory_conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (inventory_conversion_factor > 0),
  regulatory_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','pending','approved','rejected','retired')),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  technical_notes TEXT,
  created_by INTEGER,
  approved_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  institute_id integer,
  UNIQUE (manufacturer_id, normalized_manufacturer_part_number),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

-- Source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE TABLE IF NOT EXISTS public.approved_spare_parts (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  spare_part_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  generic_item_id BIGINT,
  preferred_approved_product_id BIGINT,
  manufacturer_name TEXT,
  oem_part_number TEXT,
  manufacturer_part_number TEXT,
  drawing_number TEXT,
  revision TEXT,
  technical_specification TEXT,
  spare_part_type TEXT NOT NULL CHECK (spare_part_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  criticality TEXT NOT NULL CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  failure_consequence TEXT NOT NULL CHECK (failure_consequence IN ('PATIENT_SAFETY','EQUIPMENT_SHUTDOWN','SERVICE_DEGRADATION','MAINTENANCE_EFFICIENCY','NON_CRITICAL')),
  interchangeability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (interchangeability_status IN ('EXACT','INTERCHANGEABLE','CONDITIONAL','NOT_INTERCHANGEABLE','UNKNOWN')),
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED')),
  is_repairable BOOLEAN NOT NULL DEFAULT false,
  is_serialized BOOLEAN NOT NULL DEFAULT false,
  is_consumable BOOLEAN NOT NULL DEFAULT true,
  is_safety_critical BOOLEAN NOT NULL DEFAULT false,
  recommended_stocking_policy TEXT NOT NULL DEFAULT 'ORDER_ON_DEMAND' CHECK (recommended_stocking_policy IN ('DO_NOT_STOCK','NORMAL_STOCK','SAFETY_STOCK','STRATEGIC_STOCK','ORDER_ON_DEMAND')),
  recommended_min_quantity NUMERIC,
  recommended_max_quantity NUMERIC,
  recommended_safety_stock NUMERIC,
  typical_lead_time_days INTEGER,
  estimated_annual_consumption NUMERIC,
  shelf_life_days INTEGER,
  storage_conditions TEXT,
  technical_approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (technical_approval_status IN ('DRAFT','UNDER_REVIEW','APPROVED','CONDITIONALLY_APPROVED','REJECTED')),
  technical_approved_by INTEGER,
  technical_approved_at TIMESTAMPTZ,
  technical_approval_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  stock_item_id integer,
  CONSTRAINT approved_spare_parts_quantities_nonnegative CHECK (
    (recommended_min_quantity IS NULL OR recommended_min_quantity >= 0) AND
    (recommended_max_quantity IS NULL OR recommended_max_quantity >= 0) AND
    (recommended_safety_stock IS NULL OR recommended_safety_stock >= 0) AND
    (estimated_annual_consumption IS NULL OR estimated_annual_consumption >= 0) AND
    (typical_lead_time_days IS NULL OR typical_lead_time_days >= 0) AND
    (shelf_life_days IS NULL OR shelf_life_days >= 0) AND
    (recommended_min_quantity IS NULL OR recommended_max_quantity IS NULL OR recommended_max_quantity >= recommended_min_quantity)),
  CONSTRAINT approved_spare_parts_approval_evidence CHECK (
    (technical_approval_status IN ('DRAFT','UNDER_REVIEW') AND technical_approved_by IS NULL AND technical_approved_at IS NULL)
    OR (technical_approval_status IN ('APPROVED','CONDITIONALLY_APPROVED','REJECTED') AND technical_approved_by IS NOT NULL AND technical_approved_at IS NOT NULL)),
  CONSTRAINT approved_spare_parts_reason_required CHECK (
    technical_approval_status NOT IN ('CONDITIONALLY_APPROVED','REJECTED') OR nullif(btrim(technical_approval_reason),'') IS NOT NULL)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_categories (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  code varchar(40) NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  parent_category_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institute_id,code)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_exceptions (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  asset_id bigint,
  asset_tag_id bigint,
  rfid_business_event_id bigint,
  exception_type varchar(40) NOT NULL CHECK(exception_type IN('UNAUTHORIZED_MOVEMENT','UNKNOWN_TAG','LOCATION_MISMATCH','MISSING_ASSET','DUPLICATE_SERIAL_REVIEW','RFID_CONFIGURATION')),
  severity varchar(20) NOT NULL CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')),
  status varchar(20) NOT NULL CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED')),
  detected_at timestamptz NOT NULL,
  acknowledged_by integer,
  acknowledged_at timestamptz,
  resolved_by integer,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rfid_business_event_id,exception_type)
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_discoveries (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  session_id bigint NOT NULL,
  description text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  observed_location_id bigint,
  department_id integer,
  condition_observed varchar(30),
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}',
  discovered_by integer NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  registered_asset_id bigint,
  registered_at timestamptz,
  UNIQUE(institute_id,id)
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_expected_assets (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  session_id bigint NOT NULL,
  asset_id bigint NOT NULL,
  asset_number_snapshot varchar(60) NOT NULL,
  description_snapshot text NOT NULL,
  category_id bigint,
  category_name_snapshot text,
  expected_location_id bigint,
  expected_location_name_snapshot text,
  expected_department_id integer,
  expected_department_name_snapshot text,
  expected_section_id integer,
  expected_section_name_snapshot text,
  expected_custodian_user_id integer,
  expected_custodian_name_snapshot text,
  operational_status_snapshot varchar(30) NOT NULL,
  condition_snapshot varchar(30) NOT NULL,
  expected_rfid_epc_snapshot varchar(128),
  snapshot_at timestamptz NOT NULL,
  UNIQUE(session_id,asset_id)
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_findings (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  session_id bigint NOT NULL,
  expected_asset_id bigint,
  asset_id bigint,
  observation_id bigint,
  discovery_id bigint,
  finding_type varchar(40) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'MEDIUM' CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  context jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by integer,
  resolved_at timestamptz,
  resolved_by integer,
  resolution_code varchar(60),
  resolution_notes text,
  CONSTRAINT asset_inventory_findings_type_ck CHECK(finding_type IN('VERIFIED','MISSING','UNEXPECTED','WRONG_LOCATION','RESPONSIBILITY_MISMATCH','CUSTODY_MISMATCH','IDENTIFICATION_CONFLICT','CONDITION_MISMATCH','STATUS_MISMATCH','REQUIRES_INVESTIGATION','UNREGISTERED')),
  UNIQUE(session_id,finding_type,asset_id,observation_id,discovery_id)
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_number_allocators (
  institute_id integer PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0),
  prefix varchar(20) NOT NULL DEFAULT 'WICI-FAI'
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_observations (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  session_id bigint NOT NULL,
  asset_id bigint,
  observed_identifier text NOT NULL,
  observation_method varchar(20) NOT NULL CHECK(observation_method IN('MANUAL','QR','RFID')),
  observed_location_id bigint,
  observed_department_id integer,
  observed_custodian_user_id integer,
  observed_at timestamptz NOT NULL,
  observed_by integer NOT NULL,
  rfid_read_event_id bigint,
  rfid_business_event_id bigint,
  notes text,
  condition_observed varchar(30),
  operational_status_observed varchar(30),
  raw_evidence jsonb NOT NULL DEFAULT '{}',
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,dedupe_key)
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_resolutions (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  finding_id bigint NOT NULL,
  from_status varchar(20) NOT NULL,
  to_status varchar(20) NOT NULL CHECK(to_status IN('ACKNOWLEDGED','RESOLVED','DISMISSED')),
  resolution_code varchar(60),
  resolution_notes text NOT NULL,
  business_object_type varchar(50),
  business_object_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL
);

-- Source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE TABLE IF NOT EXISTS public.asset_inventory_sessions (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  session_number varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  scope_type varchar(30) NOT NULL CHECK(scope_type IN('LOCATION','DEPARTMENT','FULL_INSTITUTE')),
  scope_location_id bigint,
  scope_department_id integer,
  include_descendants boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','OPEN','COUNTING','REVIEW','COMPLETED','CANCELLED')),
  started_at timestamptz,
  started_by integer,
  counting_started_at timestamptz,
  review_started_at timestamptz,
  completed_at timestamptz,
  completed_by integer,
  cancelled_at timestamptz,
  cancelled_by integer,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  UNIQUE(institute_id,session_number),
  CHECK((scope_type='LOCATION' AND scope_location_id IS NOT NULL AND scope_department_id IS NULL) OR (scope_type='DEPARTMENT' AND scope_department_id IS NOT NULL AND scope_location_id IS NULL) OR (scope_type='FULL_INSTITUTE' AND scope_location_id IS NULL AND scope_department_id IS NULL))
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_locations (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  code varchar(40) NOT NULL,
  name varchar(160) NOT NULL,
  location_type varchar(30) NOT NULL CHECK(location_type IN('CAMPUS','BUILDING','FLOOR','DEPARTMENT_AREA','SECTION_AREA','ROOM','STORE','WORKSHOP','EXTERNAL','OTHER')),
  parent_location_id bigint,
  department_id integer,
  section_id integer,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(parent_location_id IS DISTINCT FROM id),
  UNIQUE(institute_id,code)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_movements (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  asset_id bigint NOT NULL,
  from_department_id integer,
  from_location_id bigint,
  to_department_id integer,
  to_location_id bigint,
  movement_type varchar(40) NOT NULL CHECK(movement_type IN('PERMANENT_TRANSFER','TEMPORARY_LOAN','MAINTENANCE_TRANSFER','EXTERNAL_MAINTENANCE','RETURN','STORAGE_TRANSFER','DISPOSAL_TRANSFER','LOCATION_CORRECTION')),
  requested_by integer NOT NULL,
  approved_by integer,
  dispatched_by integer,
  received_by integer,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  expected_return_at timestamptz,
  actual_return_at timestamptz,
  reason text NOT NULL,
  status varchar(30) NOT NULL CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','IN_TRANSIT','RECEIVED','RETURNED','CANCELLED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  origin_movement_id bigint NULL
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_number_allocators (
  institute_id integer PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0),
  prefix varchar(20) NOT NULL DEFAULT 'WICI-A'
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.asset_tags (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  asset_id bigint NOT NULL,
  tag_type varchar(20) NOT NULL CHECK(tag_type IN('RFID_UHF','RFID_HF','QR','BARCODE','OTHER')),
  epc varchar(128),
  tid varchar(256),
  qr_value text,
  tag_status varchar(30) NOT NULL CHECK(tag_status IN('PENDING_ENCODING','ACTIVE','DAMAGED','LOST','RETIRED','REPLACED')),
  is_primary boolean NOT NULL DEFAULT false,
  installed_at timestamptz,
  installed_by integer,
  retired_at timestamptz,
  retired_by integer,
  replacement_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(epc IS NULL OR epc=upper(regexp_replace(epc,'\s','','g')))
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.assets (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  asset_number varchar(60) NOT NULL,
  asset_class varchar(20) NOT NULL CHECK(asset_class IN('CAPITAL','CONTROLLED')),
  asset_category_id bigint NOT NULL,
  description text NOT NULL,
  generic_item_id bigint,
  approved_product_id bigint,
  stock_item_id integer,
  manufacturer text,
  model text,
  serial_number text,
  finance_asset_number text,
  acquisition_method varchar(30) NOT NULL CHECK(acquisition_method IN('PURCHASE','DONATION','TRANSFER_IN','LEASE','LOAN','LEGACY','OTHER')),
  purchase_request_id integer,
  requested_item_id integer,
  purchase_order_id bigint,
  purchase_order_item_id bigint,
  goods_receipt_id bigint,
  goods_receipt_item_id bigint,
  supplier_id integer,
  acquisition_date date,
  acquisition_cost numeric(20,4) CHECK(acquisition_cost>=0),
  currency char(3),
  capitalization_status varchar(30) NOT NULL DEFAULT 'NOT_ASSESSED',
  ownership_type varchar(30) NOT NULL CHECK(ownership_type IN('INSTITUTE_OWNED','LEASED','SUPPLIER_OWNED','LOANED','DONATED','OTHER')),
  owner_name text,
  responsible_department_id integer,
  current_location_id bigint,
  condition varchar(30) NOT NULL CHECK(condition IN('NEW','GOOD','FAIR','DAMAGED','UNDER_REPAIR','UNSERVICEABLE','UNKNOWN')),
  operational_status varchar(30) NOT NULL CHECK(operational_status IN('IN_SERVICE','IN_STORAGE','UNDER_MAINTENANCE','OUT_OF_SERVICE','MISSING','RETIRED','DISPOSED')),
  reconciliation_status varchar(20) NOT NULL CHECK(reconciliation_status IN('VERIFIED','UNVERIFIED','MISMATCH','MISSING','UNKNOWN')),
  warranty_expiry date,
  creation_source varchar(30) NOT NULL CHECK(creation_source IN('PROCUREMENT','LEGACY_RECOVERY','IMPORT','MANUAL','SYSTEM')),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  responsible_section_id integer NULL,
  deployment_date date NULL,
  acquisition_currency varchar(3) NULL,
  exchange_rate_to_iqd numeric(24,6) NULL,
  acquisition_amount_iqd numeric(24,0) NULL,
  exchange_rate_effective_date date NULL,
  exchange_rate_source text NULL,
  UNIQUE(institute_id,asset_number)
);

-- Source: controllers/contractsController.js:3743
CREATE TABLE IF NOT EXISTS public.contract_ai_extractions (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  document_id BIGINT,
  document_version_id BIGINT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT,
  model TEXT,
  extracted_parties JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_dates JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_payment_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_renewal_clause JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_termination_clause JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_obligations JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  confidence_score NUMERIC(5,2),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_ai_extractions_status_check CHECK (extraction_status IN ('pending','processing','completed','failed','skipped'))
);

-- Source: controllers/contractsController.js:995
CREATE TABLE IF NOT EXISTS public.contract_alerts (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  threshold_value TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:981
CREATE TABLE IF NOT EXISTS public.contract_amendments (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  amendment_number INTEGER NOT NULL,
  amendment_date DATE,
  change_summary TEXT,
  revised_value NUMERIC(14,2),
  revised_expiry DATE,
  approved_by INTEGER,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:1007
CREATE TABLE IF NOT EXISTS public.contract_approvals (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  workflow_level INTEGER NOT NULL DEFAULT 1,
  is_active_level BOOLEAN NOT NULL DEFAULT FALSE,
  stage TEXT NOT NULL,
  reviewer_role TEXT,
  reviewer_id INTEGER,
  decision TEXT,
  comments TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Pending',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  reviewer_department_id INTEGER,
  review_sections JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Source: controllers/contractGovernanceController.js:63
CREATE TABLE IF NOT EXISTS public.contract_clause_assignments (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  clause_id INTEGER NOT NULL,
  custom_override_content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractGovernanceController.js:50
CREATE TABLE IF NOT EXISTS public.contract_clauses (
  id SERIAL PRIMARY KEY,
  clause_type TEXT,
  clause_title TEXT NOT NULL,
  clause_content TEXT NOT NULL,
  clause_version INTEGER NOT NULL DEFAULT 1,
  language TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:3797
CREATE TABLE IF NOT EXISTS public.contract_consumption (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id BIGINT,
  consumption_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IQD',
  invoice_id BIGINT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:1123
CREATE TABLE IF NOT EXISTS public.contract_document_versions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL,
  contract_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL,
  file_name TEXT,
  file_url TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size BIGINT,
  checksum TEXT,
  uploaded_by BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  UNIQUE(document_id, version_number)
);

-- Source: controllers/contractsController.js:1109
CREATE TABLE IF NOT EXISTS public.contract_documents (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  document_type TEXT NOT NULL,
  title TEXT,
  description TEXT,
  current_version_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_documents_document_type_check CHECK (document_type = ANY(ARRAY['draft','signed_contract','amendment','invoice','supporting_document','legal_review','technical_attachment','financial_attachment','other'])),
  CONSTRAINT contract_documents_status_check CHECK (status = ANY(ARRAY['active','superseded','archived']))
);

-- Source: sql/manual/021_contract_equipment_coverage.sql
CREATE TABLE IF NOT EXISTS public.contract_equipment_coverage (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  contract_id integer NOT NULL,
  equipment_id bigint NOT NULL,
  coverage_type text NOT NULL CHECK (coverage_type IN ('WARRANTY','PREVENTIVE','CORRECTIVE','COMPREHENSIVE','CALIBRATION','SOFTWARE_SUPPORT','OTHER')),
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  pm_included boolean NOT NULL DEFAULT false,
  corrective_included boolean NOT NULL DEFAULT false,
  labor_included boolean NOT NULL DEFAULT false,
  parts_included boolean NOT NULL DEFAULT false,
  consumables_included boolean NOT NULL DEFAULT false,
  travel_included boolean NOT NULL DEFAULT false,
  software_included boolean NOT NULL DEFAULT false,
  calibration_included boolean NOT NULL DEFAULT false,
  response_time_hours numeric(10,2),
  resolution_time_hours numeric(10,2),
  uptime_target_percent numeric(5,2),
  coverage_limit numeric(20,4),
  currency char(3),
  notes text,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_equipment_coverage_dates_ck CHECK (coverage_end >= coverage_start),
  CONSTRAINT contract_equipment_coverage_sla_ck CHECK (
      (response_time_hours IS NULL OR response_time_hours >= 0) AND
      (resolution_time_hours IS NULL OR resolution_time_hours >= 0) AND
      (uptime_target_percent IS NULL OR uptime_target_percent BETWEEN 0 AND 100) AND
      (coverage_limit IS NULL OR coverage_limit >= 0)
    ),
  UNIQUE (contract_id,equipment_id,coverage_start,coverage_type)
);

-- Source: controllers/contractsController.js:3774
CREATE TABLE IF NOT EXISTS public.contract_invoices (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT,
  supplier_id BIGINT,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  received_date DATE,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IQD',
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  retention_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  matching_status TEXT NOT NULL DEFAULT 'not_checked',
  matching_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  document_id BIGINT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:1034
CREATE TABLE IF NOT EXISTS public.contract_items (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  item_id INTEGER,
  generic_item_id bigint,
  approved_product_id bigint,
  supplier_catalog_item_id bigint,
  item_name TEXT NOT NULL,
  generic_name TEXT,
  brand_name TEXT,
  unit TEXT,
  contracted_price NUMERIC(14,2),
  currency TEXT,
  minimum_order_quantity NUMERIC(14,2),
  lead_time_days INTEGER,
  warranty_terms TEXT,
  requested_quantity NUMERIC(14,2),
  delivered_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  price_valid_from DATE,
  price_valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractGovernanceController.js:116
CREATE TABLE IF NOT EXISTS public.contract_legal_reviews (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  reviewer_id INTEGER,
  legal_risk_level TEXT,
  flagged_clauses JSONB,
  approved_clauses JSONB,
  comments TEXT,
  governing_law TEXT,
  jurisdiction TEXT,
  approved BOOLEAN,
  reviewed_at TIMESTAMPTZ
);

-- Source: controllers/contractsController.js:1077
CREATE TABLE IF NOT EXISTS public.contract_logs (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractGovernanceController.js:102
CREATE TABLE IF NOT EXISTS public.contract_negotiations (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  negotiation_round INTEGER NOT NULL,
  discussion_summary TEXT,
  requested_changes JSONB,
  approved_changes JSONB,
  rejected_changes JSONB,
  negotiated_value NUMERIC(14,2),
  negotiated_terms JSONB,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:1170
CREATE TABLE IF NOT EXISTS public.contract_obligations (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  obligation_type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  description TEXT,
  responsible_party TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  completion_notes TEXT,
  completed_at TIMESTAMPTZ,
  proof_attachment_id INTEGER,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_user_id BIGINT,
  owner_department_id BIGINT,
  recurrence TEXT NOT NULL DEFAULT 'none',
  recurrence_interval INTEGER,
  next_due_date DATE,
  evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_document_id BIGINT,
  priority TEXT NOT NULL DEFAULT 'medium',
  completed_by BIGINT,
  CONSTRAINT contract_obligations_type_check CHECK (obligation_type = ANY(ARRAY['general','payment','delivery','reporting','compliance','maintenance','warranty','sla','renewal','termination','documentation','other'])),
  CONSTRAINT contract_obligations_recurrence_check CHECK (recurrence = ANY(ARRAY['none','daily','weekly','monthly','quarterly','semiannual','annual','custom'])),
  CONSTRAINT contract_obligations_priority_check CHECK (priority = ANY(ARRAY['low','medium','high','critical'])),
  CONSTRAINT contract_obligations_status_check CHECK (status = ANY(ARRAY['open','in_progress','completed','overdue','waived','cancelled']))
);

-- Source: controllers/contractsController.js:3791
CREATE TABLE IF NOT EXISTS public.contract_payments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IQD',
  payment_date DATE,
  notes TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invoice_id BIGINT,
  payment_reference TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractsController.js:1181
CREATE TABLE IF NOT EXISTS public.contract_renewal_events (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  renewal_type TEXT,
  renewal_date DATE,
  notice_days INTEGER NOT NULL DEFAULT 90,
  alert_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  decision_notes TEXT,
  decided_by BIGINT,
  decided_at TIMESTAMPTZ,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_renewal_events_status_check CHECK (status = ANY(ARRAY['pending','alerted','under_review','renewed','not_renewed','cancelled','completed'])),
  CONSTRAINT contract_renewal_events_decision_check CHECK (decision IS NULL OR decision = ANY(ARRAY['renew','do_not_renew','renegotiate','terminate','extend_temporarily']))
);

-- Source: controllers/contractsController.js:1064
CREATE TABLE IF NOT EXISTS public.contract_required_documents (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  is_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_id INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contract_id, document_type)
);

-- Source: controllers/contractsController.js:3742
CREATE TABLE IF NOT EXISTS public.contract_risk_assessments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low',
  risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assessed_by BIGINT,
  assessment_source TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_risk_assessments_level_check CHECK (risk_level IN ('low','medium','high','critical')),
  CONSTRAINT contract_risk_assessments_source_check CHECK (assessment_source IN ('system','manual','ai','scheduled'))
);

-- Source: controllers/contractGovernanceController.js:89
CREATE TABLE IF NOT EXISTS public.contract_sla_events (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  event_type TEXT,
  response_time_minutes INTEGER,
  resolution_time_minutes INTEGER,
  target_response_minutes INTEGER,
  target_resolution_minutes INTEGER,
  breached BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractGovernanceController.js:35
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id SERIAL PRIMARY KEY,
  template_name TEXT NOT NULL,
  contract_category TEXT,
  contract_type TEXT,
  default_currency TEXT,
  default_sections JSONB,
  default_clauses JSONB,
  default_alert_rules JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: controllers/contractGovernanceController.js:142
CREATE TABLE IF NOT EXISTS public.contract_versions (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_summary TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
CREATE TABLE IF NOT EXISTS public.department_item_follow_up_notes (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NULL,
  requested_item_id INTEGER NULL,
  department_id INTEGER NOT NULL,
  section_id INTEGER NULL,
  created_by INTEGER NULL,
  note TEXT NOT NULL,
  department_response TEXT NULL,
  next_follow_up_date DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Source: sql/manual/012_procurement_priority_foundation.sql
CREATE TABLE IF NOT EXISTS public.department_priority_rankings (
  id BIGSERIAL PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL,
  institute_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  department_rank INTEGER NOT NULL CHECK (department_rank > 0),
  department_rank_total INTEGER NOT NULL CHECK (department_rank_total >= department_rank),
  ranked_by BIGINT NOT NULL,
  ranked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (institute_id, department_id, department_rank, valid_until)
);

-- Source: sql/migrations/20260929_document_branding.sql
CREATE TABLE IF NOT EXISTS public.document_branding_settings (
  key TEXT PRIMARY KEY,
  logo_data TEXT,
  document_code VARCHAR(80),
  template_data TEXT,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/development/20261005_02_employee_tasks.sql
CREATE TABLE IF NOT EXISTS public.employee_tasks (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text,
  assigned_to integer NOT NULL,
  assigned_by integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  employee_update text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.generic_item_merges (
  id BIGSERIAL PRIMARY KEY,
  source_generic_item_id BIGINT NOT NULL,
  target_generic_item_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'merge_pending' CHECK (status IN ('merge_pending','completed','rejected')),
  merge_reason TEXT NOT NULL,
  conflict_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (source_generic_item_id <> target_generic_item_id)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.generic_items (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  generic_name TEXT NOT NULL,
  canonical_description TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  item_type TEXT NOT NULL,
  specification JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_uom TEXT NOT NULL,
  inventory_uom TEXT NOT NULL,
  purchasing_uom TEXT,
  conversion_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  criticality TEXT NOT NULL DEFAULT 'routine' CHECK (criticality IN ('routine','essential','critical','life_sustaining')),
  hazard_information JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_sterile BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  batch_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  serial_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','review','validation','approval','active','retired')),
  standardization_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (standardization_status IN ('unreviewed','standard','restricted','exception')),
  interchangeability_policy TEXT NOT NULL DEFAULT 'approval_required' CHECK (interchangeability_policy IN ('fully_interchangeable','conditionally_interchangeable','non_interchangeable','proprietary','approval_required')),
  is_proprietary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  structured_fingerprint TEXT NOT NULL,
  category_id INTEGER,
  base_uom_id INTEGER,
  inventory_uom_id INTEGER,
  purchasing_uom_id INTEGER,
  created_by INTEGER,
  updated_by INTEGER,
  approved_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  institute_id integer,
  CHECK (NOT is_proprietary OR interchangeability_policy = 'proprietary'),
  CHECK (is_active = (lifecycle_status = 'active'))
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_cycle_count_lines (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cycle_count_id bigint NOT NULL,
  stock_item_id integer NOT NULL,
  warehouse_stock_level_id integer,
  system_quantity numeric NOT NULL,
  counted_quantity numeric,
  variance numeric,
  counted_by integer,
  counted_at timestamptz,
  posted_movement_id integer,
  posted_at timestamptz,
  UNIQUE(cycle_count_id,warehouse_stock_level_id)
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_cycle_counts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  warehouse_id integer NOT NULL,
  status text NOT NULL CHECK(status IN('OPEN','COUNTING','REVIEW','APPROVED','POSTED')),
  notes text,
  opened_by integer NOT NULL,
  reviewed_by integer,
  reviewed_at timestamptz,
  posted_by integer,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_reservation_allocations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL,
  warehouse_stock_level_id integer NOT NULL,
  reserved_quantity numeric NOT NULL CHECK(reserved_quantity>0),
  consumed_quantity numeric NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0),
  released_quantity numeric NOT NULL DEFAULT 0 CHECK(released_quantity>=0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reservation_id,warehouse_stock_level_id),
  CHECK(consumed_quantity+released_quantity<=reserved_quantity)
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_reservation_issue_operations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL,
  idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>''),
  requested_quantity numeric NOT NULL CHECK(requested_quantity>0),
  inventory_movement_id integer NOT NULL UNIQUE,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reservation_id,idempotency_key)
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  warehouse_id integer NOT NULL,
  stock_item_id integer NOT NULL,
  document_type text NOT NULL,
  document_id text NOT NULL,
  document_line_id text,
  quantity numeric NOT NULL CHECK(quantity>0),
  status text NOT NULL CHECK(status IN('ACTIVE','RELEASED','CONSUMED','EXPIRED','CANCELLED')),
  idempotency_key text NOT NULL UNIQUE CHECK(btrim(idempotency_key)<>''),
  expires_at timestamptz,
  created_by integer NOT NULL,
  released_by integer,
  released_at timestamptz,
  consumed_by integer,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_quantity numeric NOT NULL DEFAULT 0
);

-- Source: sql/manual/004_inventory_transaction_engine.sql
CREATE TABLE IF NOT EXISTS public.inventory_transaction_allocations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  inventory_transaction_id integer NOT NULL,
  warehouse_stock_level_id integer,
  warehouse_id integer NOT NULL,
  stock_item_id integer NOT NULL,
  stock_status text NOT NULL CHECK (stock_status IN ('AVAILABLE','QUARANTINE','BLOCKED','RECALLED','DAMAGED','EXPIRED')),
  quantity numeric NOT NULL CHECK (quantity <> 0),
  batch_number text,
  lot_number text,
  serial_number text,
  expiry_date date,
  base_uom text NOT NULL,
  allocation_sequence integer NOT NULL CHECK (allocation_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (inventory_transaction_id, allocation_sequence)
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_transfer_allocation_links (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  transfer_id integer NOT NULL,
  transfer_line_id integer NOT NULL,
  dispatch_movement_id integer NOT NULL,
  dispatch_allocation_id bigint NOT NULL,
  dispatched_quantity numeric NOT NULL CHECK(dispatched_quantity>0),
  received_quantity numeric NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=dispatched_quantity),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dispatch_allocation_id),
  UNIQUE(transfer_id,transfer_line_id,dispatch_movement_id,dispatch_allocation_id)
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_transfer_movement_links (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  transfer_id integer NOT NULL,
  transfer_line_id integer NOT NULL UNIQUE,
  dispatch_movement_id integer NOT NULL UNIQUE,
  receipt_movement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  dispatched_quantity numeric NOT NULL CHECK(dispatched_quantity>0),
  received_quantity numeric NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=dispatched_quantity),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Source: sql/manual/005_inventory_operations.sql
CREATE TABLE IF NOT EXISTS public.inventory_transfer_receipt_operations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  transfer_id integer NOT NULL,
  idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>''),
  receipt_movement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(transfer_id,idempotency_key)
);

-- Source: sql/manual/006_connected_procure_to_pay.sql
CREATE TABLE IF NOT EXISTS public.invoice_match_override_decisions (
  id BIGSERIAL PRIMARY KEY,
  invoice_match_result_id BIGINT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','DECLINED')),
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  original_variances JSONB NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.item_duplicate_reviews (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('generic_item','approved_product','supplier_catalog_item')),
  source_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  score NUMERIC(5,4) NOT NULL CHECK (score >= 0 AND score <= 1),
  matching_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','duplicate','not_duplicate','merged')),
  reviewed_by INTEGER,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (entity_type, source_id, candidate_id),
  CHECK (source_id <> candidate_id)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.item_master_aliases (
  id BIGSERIAL PRIMARY KEY,
  generic_item_id BIGINT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('legacy_name','legacy_code','request_snapshot','merged_item')),
  alias_value TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source_table TEXT,
  source_id BIGINT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generic_item_id, alias_type, normalized_alias)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.item_master_audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  action TEXT NOT NULL,
  actor_id INTEGER,
  reason TEXT,
  previous_values JSONB,
  new_values JSONB,
  request_id INTEGER,
  requested_item_id INTEGER,
  source_id BIGINT,
  target_id BIGINT,
  organizational_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: utils/ensureFinanceCoreTables.js:50
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER,
  journal_type TEXT NOT NULL CHECK (journal_type IN ('ap_voucher', 'payment', 'adjustment', 'accrual', 'manual')),
  source_type TEXT NOT NULL,
  source_id TEXT,
  journal_reference TEXT NOT NULL UNIQUE,
  entry_status TEXT NOT NULL DEFAULT 'posted',
  currency TEXT NOT NULL DEFAULT 'USD',
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  posted_by INTEGER,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: utils/ensureFinanceCoreTables.js:64
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_entry_id BIGINT NOT NULL,
  line_no INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  cost_center_id INTEGER,
  debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journal_entry_id, line_no)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.legacy_item_mappings (
  id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL CHECK (source_table IN ('item_master','item_master_items')),
  legacy_item_id BIGINT NOT NULL,
  generic_item_id BIGINT NOT NULL,
  legacy_code_snapshot TEXT,
  legacy_name_snapshot TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'active' CHECK (mapping_status IN ('active','superseded','rejected')),
  mapping_reason TEXT NOT NULL,
  mapped_by INTEGER NOT NULL,
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE TABLE IF NOT EXISTS public.maintainable_equipment (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  equipment_code TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  department_id INTEGER,
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  asset_id bigint
);

-- Source: sql/manual/025_maintenance_inventory_execution.sql
CREATE TABLE IF NOT EXISTS public.maintenance_part_inventory_operations (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  work_order_part_id bigint NOT NULL,
  operation_type text NOT NULL CHECK(operation_type IN('RESERVE','ISSUE','RELEASE','RETURN')),
  quantity numeric(18,6) NOT NULL CHECK(quantity>0),
  idempotency_key text NOT NULL,
  reservation_id bigint,
  inventory_movement_id integer,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institute_id,operation_type,idempotency_key)
);

-- Source: sql/manual/024_maintenance_work_orders.sql
CREATE TABLE IF NOT EXISTS public.maintenance_work_order_allocators (
  institute_id integer PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0)
);

-- Source: sql/manual/024_maintenance_work_orders.sql
CREATE TABLE IF NOT EXISTS public.maintenance_work_order_parts (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  work_order_id bigint NOT NULL,
  spare_part_id bigint NOT NULL,
  stock_item_id integer NOT NULL,
  quantity_planned numeric(18,6) NOT NULL CHECK(quantity_planned>0),
  quantity_used numeric(18,6) NOT NULL DEFAULT 0 CHECK(quantity_used>=0),
  action text NOT NULL DEFAULT 'PLANNED' CHECK(action IN('PLANNED','RESERVED','ISSUED','INSTALLED','REMOVED','RETURNED_UNUSED','RETURNED_FOR_REPAIR','SCRAPPED')),
  installed_serial_number text,
  removed_serial_number text,
  notes text,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reservation_id bigint,
  issued_inventory_movement_id integer,
  reserved_at timestamptz,
  issued_at timestamptz,
  CHECK(quantity_used<=quantity_planned OR action IN('REMOVED','RETURNED_FOR_REPAIR','SCRAPPED'))
);

-- Source: sql/manual/024_maintenance_work_orders.sql
CREATE TABLE IF NOT EXISTS public.maintenance_work_orders (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  work_order_number text NOT NULL,
  equipment_id bigint NOT NULL,
  coverage_id bigint,
  work_order_type text NOT NULL CHECK(work_order_type IN('CORRECTIVE','PREVENTIVE','CALIBRATION','INSPECTION','INSTALLATION','OTHER')),
  priority text NOT NULL CHECK(priority IN('CRITICAL','HIGH','MEDIUM','LOW')),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED')),
  problem_description text NOT NULL,
  failure_code text,
  resolution_summary text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  assigned_to integer,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1,
  CHECK(completed_at IS NULL OR started_at IS NULL OR completed_at>=started_at),
  CHECK(downtime_ended_at IS NULL OR downtime_started_at IS NULL OR downtime_ended_at>=downtime_started_at),
  UNIQUE(institute_id,work_order_number),
  UNIQUE(institute_id,id)
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  recipient_user_id integer,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed')),
  retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
CREATE TABLE IF NOT EXISTS public.organization_head_reconciliation_decisions (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  organization_unit_id BIGINT NOT NULL,
  legacy_user_id INTEGER,
  organization_head_position_id BIGINT NOT NULL,
  organization_head_user_id INTEGER NOT NULL,
  decision VARCHAR(40) NOT NULL CONSTRAINT organization_head_reconciliation_decision_check CHECK (decision IN ('KEEP_EXISTING','MARK_LEGACY_OBSOLETE')),
  reason TEXT NOT NULL CONSTRAINT organization_head_reconciliation_reason_check CHECK (length(trim(reason)) > 0),
  decided_by INTEGER NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ
);

-- Source: sql/manual/014_organization_hierarchy.sql
CREATE TABLE IF NOT EXISTS public.organization_positions (
  id BIGSERIAL PRIMARY KEY,
  organization_unit_id BIGINT NOT NULL,
  position_type VARCHAR(30) NOT NULL CHECK (position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD','CUSTOM')),
  position_name VARCHAR(255) NOT NULL,
  user_id INTEGER,
  is_unit_head BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER,
  CONSTRAINT organization_positions_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

-- Source: sql/manual/014_organization_hierarchy.sql
CREATE TABLE IF NOT EXISTS public.organization_units (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  unit_type VARCHAR(30) NOT NULL CHECK (unit_type IN ('INSTITUTE','EXECUTIVE_OFFICE','DIRECTORATE','DEPARTMENT','SECTION','UNIT')),
  parent_unit_id BIGINT,
  department_id INTEGER UNIQUE,
  section_id INTEGER UNIQUE,
  classification VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER,
  CONSTRAINT organization_units_not_self_parent CHECK (parent_unit_id IS NULL OR parent_unit_id <> id),
  CONSTRAINT organization_units_legacy_identity CHECK (
    (department_id IS NULL OR (unit_type = 'DEPARTMENT' AND section_id IS NULL)) AND
    (section_id IS NULL OR (unit_type = 'SECTION' AND department_id IS NULL))
  )
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.pending_item_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER,
  requested_item_id INTEGER,
  proposed_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  category TEXT,
  required_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  intended_use TEXT NOT NULL,
  requested_quantity NUMERIC(18,6) CHECK (requested_quantity IS NULL OR requested_quantity > 0),
  requested_uom TEXT,
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','review','needs_information','mapped_existing','approved_exception','rejected','resolved')),
  resolution_type TEXT CHECK (resolution_type IS NULL OR resolution_type IN ('existing_generic','existing_product','supplier_catalog_only','new_generic_draft','approved_free_text_exception','rejected','needs_information')),
  resolved_generic_item_id BIGINT,
  resolved_product_id BIGINT,
  requester_id INTEGER NOT NULL,
  assigned_steward_id INTEGER,
  resolved_by INTEGER,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Source: controllers/demandPlanningController.js:240
CREATE TABLE IF NOT EXISTS public.planning_settings (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id BIGINT NULL,
  forecast_horizon_months INTEGER NOT NULL DEFAULT 6,
  forecast_window_size INTEGER NOT NULL DEFAULT 3,
  safety_lead_time_days INTEGER NOT NULL DEFAULT 14,
  safety_review_period_days INTEGER NOT NULL DEFAULT 7,
  demand_history_days INTEGER NOT NULL DEFAULT 120,
  demand_history_months INTEGER NOT NULL DEFAULT 12,
  safety_history_days INTEGER NOT NULL DEFAULT 180,
  mrp_horizon_days INTEGER NOT NULL DEFAULT 84,
  mrp_bucket_days INTEGER NOT NULL DEFAULT 7,
  updated_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Source: routes/printServiceRequests.js:14
CREATE TABLE IF NOT EXISTS public.print_service_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL,
  department_id INTEGER,
  section_id INTEGER,
  form_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  accepted_by INTEGER,
  accepted_at TIMESTAMPTZ,
  completed_by INTEGER,
  completed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: routes/printServiceRequests.js:14
CREATE TABLE IF NOT EXISTS public.print_service_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/manual/006_connected_procure_to_pay.sql
CREATE TABLE IF NOT EXISTS public.procurement_awards (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  request_item_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  awarded_quantity NUMERIC(18,4) NOT NULL CHECK (awarded_quantity > 0),
  unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
  currency VARCHAR(3) NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('QUOTATION','CONTRACT','FRAMEWORK_AGREEMENT','DIRECT_PURCHASE','MANUAL_EXCEPTION')),
  source_id BIGINT,
  selection_reason TEXT NOT NULL,
  actor_id INTEGER,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','SUPERSEDED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_fingerprint CHAR(64) NOT NULL,
  approved_product_id BIGINT,
  supplier_catalog_item_id BIGINT
);

-- Source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_case_activities (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_at TIMESTAMPTZ NOT NULL,
  actor_id INTEGER,
  supplier_id INTEGER,
  related_entity_type TEXT,
  related_entity_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('SYSTEM','MANUAL','OUTBOX','LEGACY')),
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source <> 'MANUAL' OR (actor_id IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes)) > 0))
);

-- Source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_case_complexity_factors (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL,
  model_version TEXT NOT NULL,
  factor_code TEXT NOT NULL,
  factor_value TEXT NOT NULL,
  points SMALLINT NOT NULL CHECK (points BETWEEN 1 AND 10),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assessed_by INTEGER NOT NULL,
  assessment_reason TEXT NOT NULL,
  UNIQUE(procurement_case_id, model_version, factor_code)
);

-- Source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_cases (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  request_id INTEGER NOT NULL,
  requested_item_id INTEGER NOT NULL,
  institute_id INTEGER NOT NULL,
  department_id INTEGER,
  assigned_buyer_id INTEGER,
  case_status TEXT NOT NULL CHECK (case_status IN ('APPROVAL_PENDING','ITEM_IDENTITY_RESOLUTION','READY_FOR_SOURCING','SOURCING','AWAITING_QUOTATION','TECHNICAL_EVALUATION','COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING','SUPPLIER_FULFILLMENT','LOGISTICS','DELIVERED','CLOSED')),
  sourcing_method TEXT,
  pending_root_cause TEXT CHECK (pending_root_cause IS NULL OR pending_root_cause IN ('ITEM_IDENTITY_RESOLUTION','SUPPLY_CHAIN_SOURCING','AWAITING_TECHNICAL_EVALUATION','AWAITING_SUPPLIER_QUOTATION','AWAITING_FINANCE_PAYMENT','SUPPLIER_MANUFACTURING','INTERNATIONAL_SHIPMENT','CUSTOMS_REGULATORY','END_USER_CLARIFICATION','APPROVAL_PENDING','OTHER')),
  pending_override_reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  sourcing_started_at TIMESTAMPTZ,
  commercially_ready_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  complexity_score SMALLINT CHECK (complexity_score BETWEEN 1 AND 100),
  complexity_class CHAR(1) CHECK (complexity_class IN ('A','B','C','D','E')),
  complexity_model_version TEXT,
  workload_units SMALLINT CHECK (workload_units IN (1,2,4,7,10)),
  workload_model_version TEXT,
  existing_supplier BOOLEAN,
  sole_source BOOLEAN,
  oem_only BOOLEAN,
  international_procurement BOOLEAN,
  discontinued_or_obsolete BOOLEAN,
  alternative_product_investigated BOOLEAN,
  strategic_highlight BOOLEAN NOT NULL DEFAULT false,
  strategic_summary JSONB,
  activity_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (activity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  complexity_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (complexity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  commercial_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (commercial_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  cycle_time_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (cycle_time_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  logistics_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (logistics_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER,
  CHECK ((complexity_score IS NULL AND complexity_class IS NULL AND complexity_model_version IS NULL AND workload_units IS NULL) OR
         (complexity_score IS NOT NULL AND complexity_class IS NOT NULL AND complexity_model_version IS NOT NULL AND workload_units IS NOT NULL)),
  CHECK (pending_override_reason IS NULL OR pending_root_cause IS NOT NULL)
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_cases (
  id bigserial PRIMARY KEY,
  title text,
  description text,
  category text,
  request_id bigint,
  department_id bigint,
  section_id bigint,
  evaluation_type text,
  evaluation_period_years numeric(20,6) DEFAULT 5,
  expected_annual_growth_rate numeric(20,6) DEFAULT 0,
  currency text,
  status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','In Review','Finalized','Cancelled')),
  recommendation_summary text,
  selected_offer_id bigint,
  created_by bigint,
  finalized_by bigint,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_criteria (
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  criteria_name text,
  criteria_group text,
  weight numeric(20,6) DEFAULT 0,
  scoring_type text,
  higher_is_better boolean DEFAULT true,
  is_required boolean DEFAULT true,
  metric_key text,
  normalization_method text,
  target_value numeric(20,6) DEFAULT 0,
  min_value numeric(20,6) DEFAULT 0,
  max_value numeric(20,6) DEFAULT 0,
  is_knockout boolean DEFAULT false,
  required_threshold numeric(20,6) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_offer_test_costs (
  unit_cost numeric(20,6) DEFAULT 0,
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  offer_id bigint,
  test_id bigint,
  pricing_method text,
  element_type text,
  quantity numeric(20,6) DEFAULT 0,
  annual_quantity numeric(20,6) DEFAULT 0,
  dependency_group text,
  alternative_group text,
  kit_price numeric(20,6) DEFAULT 0,
  tests_per_kit numeric(20,6) DEFAULT 0,
  usable_tests_per_kit numeric(20,6) DEFAULT 0,
  open_vial_stability_days numeric(20,6) DEFAULT 0,
  onboard_stability_days numeric(20,6) DEFAULT 0,
  shelf_life_months numeric(20,6) DEFAULT 0,
  expected_waste_percentage numeric(20,6) DEFAULT 0,
  repeat_rate_percentage numeric(20,6) DEFAULT 0,
  qc_frequency_per_kit numeric(20,6) DEFAULT 0,
  qc_cost_per_kit numeric(20,6) DEFAULT 0,
  calibrator_frequency_per_kit numeric(20,6) DEFAULT 0,
  calibrator_cost_per_kit numeric(20,6) DEFAULT 0,
  fixed_consumable_cost_per_kit numeric(20,6) DEFAULT 0,
  other_kit_related_cost numeric(20,6) DEFAULT 0,
  price_per_reportable_test numeric(20,6) DEFAULT 0,
  company_absorbs_waste boolean DEFAULT false,
  company_absorbs_qc boolean DEFAULT false,
  company_absorbs_repeats boolean DEFAULT false,
  notes text,
  calculated_effective_cost_per_reported_test numeric(20,6) DEFAULT 0,
  annual_test_cost numeric(20,6) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id,test_id)
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_offers (
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  supplier_id bigint,
  supplier_name text,
  offer_name text,
  manufacturer_name text,
  model_name text,
  country_of_origin text,
  pricing_model text,
  is_disqualified boolean DEFAULT false,
  disqualification_reason text,
  compliance_status text,
  lease_monthly_payment numeric(20,6) DEFAULT 0,
  lease_term_months numeric(20,6) DEFAULT 0,
  subscription_base_fee numeric(20,6) DEFAULT 0,
  included_volume numeric(20,6) DEFAULT 0,
  overage_price numeric(20,6) DEFAULT 0,
  sla_penalty_amount numeric(20,6) DEFAULT 0,
  uptime_guarantee_percentage numeric(20,6) DEFAULT 0,
  downtime_cost numeric(20,6) DEFAULT 0,
  supplier_risk_premium numeric(20,6) DEFAULT 0,
  stockout_risk_cost numeric(20,6) DEFAULT 0,
  fx_risk_cost numeric(20,6) DEFAULT 0,
  obsolescence_risk_cost numeric(20,6) DEFAULT 0,
  penalty_or_sla_adjustment numeric(20,6) DEFAULT 0,
  device_price numeric(20,6) DEFAULT 0,
  installation_cost numeric(20,6) DEFAULT 0,
  training_cost numeric(20,6) DEFAULT 0,
  shipping_cost numeric(20,6) DEFAULT 0,
  customs_cost numeric(20,6) DEFAULT 0,
  other_initial_cost numeric(20,6) DEFAULT 0,
  device_discount_value numeric(20,6) DEFAULT 0,
  warranty_years numeric(20,6) DEFAULT 0,
  annual_maintenance_cost numeric(20,6) DEFAULT 0,
  annual_service_contract_cost numeric(20,6) DEFAULT 0,
  annual_fixed_consumables_cost numeric(20,6) DEFAULT 0,
  annual_calibration_qc_cost numeric(20,6) DEFAULT 0,
  annual_spare_parts_cost numeric(20,6) DEFAULT 0,
  expected_lifetime_years numeric(20,6) DEFAULT 0,
  delivery_time_days numeric(20,6) DEFAULT 0,
  payment_terms text,
  minimum_annual_commitment_amount numeric(20,6) DEFAULT 0,
  minimum_annual_commitment_tests numeric(20,6) DEFAULT 0,
  reagent_rental_terms text,
  free_device_included boolean DEFAULT false,
  commitment_penalty_terms text,
  technical_notes text,
  commercial_notes text,
  risk_notes text,
  technical_model jsonb DEFAULT '{}'::jsonb,
  contract_model jsonb DEFAULT '{}'::jsonb,
  package_model jsonb DEFAULT '{}'::jsonb,
  service_model jsonb DEFAULT '{}'::jsonb,
  risk_model jsonb DEFAULT '{}'::jsonb,
  scenario_metadata jsonb DEFAULT '{}'::jsonb,
  is_compliant boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_results (
  pricing_model text,
  initial_cost numeric(20,6) DEFAULT 0,
  annual_fixed_cost numeric(20,6) DEFAULT 0,
  annual_variable_test_cost numeric(20,6) DEFAULT 0,
  annual_commitment_adjustment numeric(20,6) DEFAULT 0,
  total_annual_cost numeric(20,6) DEFAULT 0,
  tco_period_cost numeric(20,6) DEFAULT 0,
  risk_adjusted_tco numeric(20,6) DEFAULT 0,
  average_cost_per_reported_test numeric(20,6) DEFAULT 0,
  total_expected_reported_tests numeric(20,6) DEFAULT 0,
  cost_score numeric(20,6) DEFAULT 0,
  technical_score numeric(20,6) DEFAULT 0,
  supplier_score numeric(20,6) DEFAULT 0,
  risk_score numeric(20,6) DEFAULT 0,
  final_weighted_score numeric(20,6) DEFAULT 0,
  commitment_volume_shortfall boolean DEFAULT false,
  shortfall_tests numeric(20,6) DEFAULT 0,
  commitment_warning text,
  rank integer,
  compliance_passed boolean DEFAULT true,
  knockout_failed boolean DEFAULT false,
  scoring_breakdown jsonb DEFAULT '{}'::jsonb,
  recommendation_reason text,
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  offer_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(evaluation_case_id,offer_id)
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_scores (
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  offer_id bigint,
  criteria_id bigint,
  evaluator_id bigint,
  weighted_score numeric(20,6) DEFAULT 0,
  raw_value numeric(20,6) DEFAULT 0,
  score numeric(20,6) DEFAULT 0,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id,criteria_id)
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.procurement_evaluation_tests (
  id bigserial PRIMARY KEY,
  evaluation_case_id bigint,
  test_name text,
  test_code text,
  category text,
  unit text,
  expected_monthly_volume numeric(20,6) DEFAULT 0,
  growth_rate numeric(20,6) DEFAULT 0,
  is_required boolean DEFAULT true,
  dependency_risk text,
  is_alternative boolean DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Source: sql/development/20261005_03_procurement_identity_policy.sql
CREATE TABLE IF NOT EXISTS public.procurement_identity_policy (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  enforce_item_identity BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/migrations/20260608_procurement_item_events.sql
CREATE TABLE IF NOT EXISTS public.procurement_item_events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  requested_item_id INTEGER NOT NULL,
  procurement_user_id INTEGER NOT NULL,
  event_quantity INTEGER NOT NULL,
  previous_purchased_quantity INTEGER NOT NULL DEFAULT 0,
  new_purchased_quantity INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  unit_cost NUMERIC(14,2) NULL,
  total_cost NUMERIC(14,2) NULL,
  supplier_id INTEGER NULL,
  supplier_name TEXT NULL,
  procurement_note TEXT NULL,
  procurement_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  overage_decided_by INTEGER,
  overage_decided_at TIMESTAMP,
  overage_decision_note TEXT,
  procurement_quantity numeric,
  procurement_unit_of_measure text,
  units_per_package numeric CHECK(units_per_package IS NULL OR units_per_package>0),
  package_unit_cost numeric,
  overage_approval_status text CHECK(overage_approval_status IS NULL OR overage_approval_status IN ('not_required','pending','approved','rejected'))
);

-- Source: sql/manual/012_procurement_priority_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_priority_group_members (
  group_id BIGINT NOT NULL,
  procurement_case_id BIGINT NOT NULL,
  added_by BIGINT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, procurement_case_id)
);

-- Source: sql/manual/012_procurement_priority_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_priority_groups (
  id BIGSERIAL PRIMARY KEY,
  institute_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  public_title TEXT,
  public_description TEXT,
  tier_override TEXT CHECK (tier_override IN ('P0','P1','P2','P3','P4')),
  tier_override_reason TEXT,
  institutional_rank INTEGER,
  institutional_rank_reason TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/manual/012_procurement_priority_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_priority_history (
  id BIGSERIAL PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('P0','P1','P2','P3','P4')),
  factor_breakdown JSONB NOT NULL,
  model_version TEXT NOT NULL,
  trigger TEXT NOT NULL,
  trigger_reason TEXT,
  institutional_rank INTEGER,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by BIGINT,
  calculated_by_system BOOLEAN NOT NULL DEFAULT false
);

-- Source: sql/manual/012_procurement_priority_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_priority_profiles (
  id BIGSERIAL PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL UNIQUE,
  institute_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  coverage_status TEXT NOT NULL DEFAULT 'NEEDS_ASSESSMENT'
    CHECK (coverage_status IN ('PARTIAL','NEEDS_ASSESSMENT','COMPLETE')),
  impact_level TEXT,
  impact_reason TEXT,
  scm_assessment SMALLINT CHECK (scm_assessment BETWEEN 0 AND 100),
  scm_reason TEXT,
  scm_assessed_by BIGINT,
  scm_assessed_at TIMESTAMPTZ,
  service_risk_level TEXT,
  service_risk_override_reason TEXT,
  deadline_at TIMESTAMPTZ,
  deadline_type TEXT,
  deadline_consequence TEXT,
  deadline_evidence_reference TEXT,
  dependency_level TEXT,
  dependency_reason TEXT,
  regulatory_level TEXT,
  regulatory_reason TEXT,
  approved_initiative_id BIGINT,
  supply_chain_owned_at TIMESTAMPTZ,
  system_score NUMERIC(5,2),
  system_tier TEXT CHECK (system_tier IN ('P0','P1','P2','P3','P4')),
  model_version TEXT NOT NULL DEFAULT 'IPPS-1.0',
  system_suggested_rank INTEGER,
  institutional_rank INTEGER,
  institutional_override_reason TEXT,
  p0_justification TEXT,
  public_title TEXT,
  public_description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  row_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE TABLE IF NOT EXISTS public.procurement_value_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('HARD_SAVINGS','COST_AVOIDANCE')),
  baseline_type TEXT NOT NULL,
  baseline_amount NUMERIC(20,4),
  final_amount NUMERIC(20,4),
  verified_value NUMERIC(20,4) NOT NULL CHECK (verified_value >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_entity_type TEXT NOT NULL,
  evidence_entity_id TEXT NOT NULL,
  notes TEXT,
  entered_by INTEGER NOT NULL,
  verified_by INTEGER,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((value_type = 'HARD_SAVINGS' AND baseline_amount IS NOT NULL AND final_amount IS NOT NULL AND baseline_amount >= final_amount AND verified_value = baseline_amount - final_amount AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
      OR (value_type = 'COST_AVOIDANCE' AND verified_value >= 0 AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes)) > 0))
);

-- Source: utils/ensureProjectsTable.js:36
CREATE TABLE IF NOT EXISTS public.project_department_visibility (
  project_id UUID NOT NULL,
  department_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, department_id)
);

-- Source: utils/ensureRequestAutoAssignmentRulesTable.js:10
CREATE TABLE IF NOT EXISTS public.request_auto_assignment_rules (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(100) NOT NULL,
  warehouse_id INTEGER NULL,
  assignee_user_id INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER NULL,
  updated_by INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: utils/ensureRequestEditApprovalsTable.js:4
CREATE TABLE IF NOT EXISTS public.request_edit_approvals (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  approval_id INTEGER,
  requested_by INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_antennas (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  reader_id bigint NOT NULL,
  antenna_port integer NOT NULL CHECK(antenna_port>0),
  name text NOT NULL,
  location_id bigint,
  antenna_type text,
  enabled boolean NOT NULL DEFAULT true,
  configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reader_id,antenna_port)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_business_events (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  event_type varchar(30) NOT NULL CHECK(event_type IN('ASSET_SEEN','LOCATION_VERIFIED','PORTAL_ENTRY','PORTAL_EXIT','AUTHORIZED_MOVEMENT','UNAUTHORIZED_MOVEMENT','UNKNOWN_TAG')),
  asset_id bigint,
  asset_tag_id bigint,
  epc varchar(128) NOT NULL,
  portal_id bigint,
  reader_id bigint,
  from_location_id bigint,
  to_location_id bigint,
  direction varchar(20) NOT NULL CHECK(direction IN('ENTERING','EXITING','UNKNOWN')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  observation_count integer NOT NULL CHECK(observation_count>0),
  confidence_score numeric(5,4) CHECK(confidence_score BETWEEN 0 AND 1),
  authorization_status varchar(20) NOT NULL CHECK(authorization_status IN('AUTHORIZED','UNAUTHORIZED','NOT_APPLICABLE','UNKNOWN')),
  related_asset_movement_id bigint,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_integration_clients (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  client_identifier varchar(100) NOT NULL UNIQUE,
  credential_hash char(64) NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['rfid:ingest'],
  enabled boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(credential_hash ~ '^[0-9a-f]{64}$')
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_portal_antennas (
  portal_id bigint NOT NULL,
  antenna_id bigint NOT NULL,
  sequence_group integer,
  direction_role varchar(20) NOT NULL DEFAULT 'UNKNOWN' CHECK(direction_role IN('SIDE_A','SIDE_B','APPROACH','DEPARTURE','UNKNOWN')),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(portal_id,antenna_id)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_portals (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  code varchar(60) NOT NULL,
  name text NOT NULL,
  location_id bigint,
  portal_type varchar(30) NOT NULL,
  from_location_id bigint,
  to_location_id bigint,
  enabled boolean NOT NULL DEFAULT true,
  configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institute_id,code)
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_read_events (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  integration_client_id bigint NOT NULL,
  epc varchar(128) NOT NULL,
  tid varchar(256),
  asset_tag_id bigint,
  asset_id bigint,
  reader_id bigint NOT NULL,
  antenna_id bigint,
  portal_id bigint,
  rssi smallint CHECK(rssi BETWEEN -120 AND 0),
  read_timestamp timestamptz NOT NULL,
  source_type varchar(20) NOT NULL CHECK(source_type IN('HANDHELD','FIXED','IMPORT','TEST')),
  external_event_id text,
  raw_payload jsonb,
  processing_status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(processing_status IN('PENDING','PROCESSING','PROCESSED','FAILED','IGNORED')),
  processing_attempts integer NOT NULL DEFAULT 0,
  processing_error text,
  business_event_id bigint,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE TABLE IF NOT EXISTS public.rfid_readers (
  id bigserial PRIMARY KEY,
  institute_id integer NOT NULL,
  code varchar(60) NOT NULL,
  name text NOT NULL,
  reader_type varchar(20) NOT NULL CHECK(reader_type IN('HANDHELD','FIXED')),
  manufacturer text,
  model text,
  serial_number text,
  device_identifier text NOT NULL,
  firmware_version text,
  ip_address inet,
  location_id bigint,
  status varchar(20) NOT NULL DEFAULT 'OFFLINE',
  last_seen_at timestamptz,
  configuration jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institute_id,code),
  UNIQUE(institute_id,device_identifier)
);

-- Source: sql/manual/006_connected_procure_to_pay.sql
CREATE TABLE IF NOT EXISTS public.rfx_response_items (
  id BIGSERIAL PRIMARY KEY,
  rfx_response_id INTEGER NOT NULL,
  requested_item_id INTEGER NOT NULL,
  quoted_quantity NUMERIC(18,4) NOT NULL CHECK (quoted_quantity > 0),
  free_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (free_quantity >= 0),
  unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  brand TEXT,
  offered_specs TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_product_id BIGINT,
  supplier_catalog_item_id BIGINT,
  UNIQUE (rfx_response_id, requested_item_id)
);

-- Source: utils/capabilityPolicyService.js:5
CREATE TABLE IF NOT EXISTS public.route_capability_policies (
  route_prefix TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  resource TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE TABLE IF NOT EXISTS public.spare_part_equipment_compatibility (
  id BIGSERIAL PRIMARY KEY,
  spare_part_id BIGINT NOT NULL,
  equipment_id BIGINT NOT NULL,
  compatibility_type TEXT NOT NULL CHECK (compatibility_type IN ('OEM_SPECIFIED','OEM_CONFIRMED','TECHNICALLY_VERIFIED','APPROVED_EQUIVALENT','CONDITIONAL')),
  compatibility_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (compatibility_status IN ('PENDING','APPROVED','REJECTED','INACTIVE')),
  serial_number_from TEXT,
  serial_number_to TEXT,
  oem_confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmation_reference TEXT,
  technical_notes TEXT,
  approved_by INTEGER,
  approved_at TIMESTAMPTZ,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compatibility_approval_evidence CHECK (compatibility_status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

-- Source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
CREATE TABLE IF NOT EXISTS public.stock_item_master_mappings (
  id BIGSERIAL PRIMARY KEY,
  stock_item_id INTEGER NOT NULL,
  generic_item_id BIGINT,
  approved_product_id BIGINT,
  mapping_status TEXT NOT NULL DEFAULT 'proposed' CHECK (mapping_status IN ('proposed','review_required','approved','rejected','superseded','rolled_back','duplicate','obsolete','excluded')),
  match_method TEXT NOT NULL,
  confidence_score NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  proposed_generic_name TEXT,
  proposed_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_name_snapshot TEXT NOT NULL,
  original_description_snapshot TEXT,
  original_brand_snapshot TEXT,
  original_category_snapshot TEXT,
  original_subcategory_snapshot TEXT,
  original_uom_snapshot TEXT,
  previous_identity JSONB,
  review_notes TEXT,
  reviewed_by INTEGER,
  reviewed_at TIMESTAMPTZ,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK (approved_product_id IS NULL OR generic_item_id IS NOT NULL)
);

-- Source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
CREATE TABLE IF NOT EXISTS public.stock_item_migration_staging (
  id BIGSERIAL PRIMARY KEY,
  source_stock_item_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_brand TEXT,
  source_category TEXT,
  source_subcategory TEXT,
  source_uom TEXT,
  source_description TEXT,
  source_quantity_snapshot NUMERIC,
  source_cost_snapshot NUMERIC,
  source_checksum TEXT NOT NULL,
  import_batch_id UUID NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validation_status TEXT NOT NULL CHECK(validation_status IN ('valid','invalid','unchanged')),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(source_stock_item_id, source_checksum)
);

-- Source: sql/migrations/20260727_item_master_foundation.sql
CREATE TABLE IF NOT EXISTS public.supplier_catalog_items (
  purchasing_uom_id INTEGER,
  id BIGSERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL,
  approved_product_id BIGINT NOT NULL,
  supplier_item_code TEXT NOT NULL,
  supplier_description TEXT,
  purchasing_uom TEXT NOT NULL,
  conversion_factor NUMERIC(18,6) NOT NULL CHECK (conversion_factor > 0),
  package_size NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_size > 0),
  minimum_order_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  order_multiple NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (order_multiple > 0),
  unit_price NUMERIC(18,6) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency CHAR(3),
  tax_rate NUMERIC(7,4) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  contract_id INTEGER,
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown','available','limited','unavailable','discontinued')),
  is_preferred_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_item_code),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

-- Source: controllers/suppliersController.js:64
CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  position TEXT,
  responsibility TEXT,
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE TABLE IF NOT EXISTS public.supplier_principals (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL,
  principal_name VARCHAR(255) NOT NULL,
  principal_country VARCHAR(120) NULL,
  relationship_type VARCHAR(80) NOT NULL,
  authorization_status VARCHAR(80) DEFAULT 'Pending Verification',
  authorization_start_date DATE NULL,
  authorization_expiry_date DATE NULL,
  authorized_categories TEXT[] NULL,
  authorized_brands TEXT[] NULL,
  authorization_document_url TEXT NULL,
  verification_notes TEXT NULL,
  verified_by INTEGER NULL,
  verified_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_principals_relationship_type_allowed_chk CHECK (relationship_type IN (
    'Manufacturer',
    'Exclusive Agent',
    'Non-Exclusive Agent',
    'Authorized Distributor',
    'Sub-distributor',
    'Service Partner',
    'Maintenance Partner'
  )),
  CONSTRAINT supplier_principals_authorization_status_allowed_chk CHECK (authorization_status IN (
    'Pending Verification',
    'Verified',
    'Expired',
    'Rejected',
    'Suspended'
  )),
  CONSTRAINT supplier_principals_date_range_chk CHECK (
    authorization_expiry_date IS NULL
    OR authorization_start_date IS NULL
    OR authorization_expiry_date >= authorization_start_date
  )
);

-- Source: backend-query-derived-contract
CREATE TABLE IF NOT EXISTS public.user_section_assignments (
  user_id integer NOT NULL,
  section_id integer NOT NULL,
  PRIMARY KEY(user_id,section_id)
);

-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS feature TEXT NOT NULL;
-- Column source: sql/manual/034_ai_provider_audit_metadata.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS provider TEXT;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS model TEXT;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED'));
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS interaction_id BIGINT NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS tool_name TEXT NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS record_count INTEGER CHECK (record_count IS NULL OR record_count >= 0);
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER NOT NULL CHECK (execution_time_ms >= 0);
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS error_code TEXT;
-- Column source: sql/manual/033_ai_intelligence_foundation.sql
ALTER TABLE public.ai_tool_executions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: backend-query-derived-contract
ALTER TABLE public.ap_vouchers ADD COLUMN IF NOT EXISTS contract_id integer;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS organization_position_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS delegator_user_id INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS delegate_user_id INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS scope VARCHAR(80) NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS created_by INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS revoked_by INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS authority_kind TEXT GENERATED ALWAYS AS (CASE WHEN organization_position_id IS NOT NULL THEN 'POSITION' ELSE 'USER' END) STORED;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS authority_id BIGINT GENERATED ALWAYS AS (COALESCE(organization_position_id,delegator_user_id::bigint)) STORED;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_authority_delegations ADD COLUMN IF NOT EXISTS effective_period TSTZRANGE GENERATED ALWAYS AS (tstzrange(effective_from,effective_to,'[)')) STORED;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS code VARCHAR(100) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS request_scope VARCHAR(50) NOT NULL DEFAULT 'PURCHASE_REQUEST';
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS policy_rule_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS condition_group INTEGER NOT NULL DEFAULT 1 CHECK(condition_group>0);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS condition_type VARCHAR(60) NOT NULL CHECK(condition_type IN('REQUEST_TYPE_EQUALS','DEPARTMENT_EQUALS','SECTION_EQUALS','DEPARTMENT_CLASSIFICATION_EQUALS','ORGANIZATION_ANCESTOR_EQUALS','AMOUNT_GTE','AMOUNT_LT','IS_STOCK_REQUEST','IS_NON_STOCK_REQUEST','IS_MAINTENANCE_REQUEST','IS_MEDICAL_DEVICE_REQUEST','IS_MEDICAL_REQUEST','WAREHOUSE_REQUIRED'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS condition_value TEXT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_conditions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS policy_rule_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS step_order INTEGER NOT NULL CHECK(step_order>0);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS approval_level INTEGER NOT NULL CHECK(approval_level>0);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS resolver_type VARCHAR(60) NOT NULL CHECK(resolver_type IN('REQUESTER','DEPARTMENT_HEAD','SECTION_HEAD','EXECUTIVE_OWNER','POSITION','CAPABILITY_HOLDER','FIXED_USER','FIXED_AUTHORITY','SUPPLY_CHAIN_AUTHORITY','COO_AUTHORITY','CEO_AUTHORITY','CFO_AUTHORITY','WAREHOUSE_AUTHORITY','MEDICAL_DEVICES_AUTHORITY'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS resolver_reference TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT true;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS parallel_group VARCHAR(100);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS semantic_key VARCHAR(100) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS display_name VARCHAR(255) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rule_steps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS policy_version_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS rule_code VARCHAR(100) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL CHECK(priority>0);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS stop_processing BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS shadow_run_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS difference_type VARCHAR(40) NOT NULL CHECK(difference_type IN('MISSING_IN_SHADOW','ADDED_BY_SHADOW','DIFFERENT_USER','DIFFERENT_LEVEL','DIFFERENT_ORDER','AMBIGUOUS_RESOLUTION','UNRESOLVED_RESOLUTION','DUPLICATE_PRINCIPAL','MATCH'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS current_step_sequence INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS shadow_step_sequence INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_differences ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS policy_version_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS existing_route_version TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS run_status VARCHAR(20) NOT NULL CHECK(run_status IN('MATCH','PARTIAL_MATCH','DIFFERENT','UNRESOLVED','ERROR'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS generated_by INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS facts_snapshot JSONB NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS shadow_run_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS approval_level INTEGER NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS parallel_group VARCHAR(100);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS semantic_key VARCHAR(100) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolver_type VARCHAR(60) NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolver_reference TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolved_user_id INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolved_user_name VARCHAR(255);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolved_unit_id BIGINT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolution_status VARCHAR(20) NOT NULL CHECK(resolution_status IN('RESOLVED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_shadow_steps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS approval_policy_id BIGINT NOT NULL;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL CHECK(version_number>0);
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL CHECK(status IN('DRAFT','VALIDATED','SHADOW','ACTIVE','RETIRED'));
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS change_reason TEXT;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS validated_by INTEGER;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
-- Column source: sql/manual/015_approval_policy_engine_foundation.sql
ALTER TABLE public.approval_policy_versions ADD COLUMN IF NOT EXISTS activated_by INTEGER;
-- Column source: backend-query-derived-contract
ALTER TABLE public.approval_route_rules ADD COLUMN IF NOT EXISTS approver_id integer;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS snapshot_id BIGINT NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS policy_rule_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS policy_step_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS approval_level INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS parallel_group VARCHAR(100);
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS semantic_key VARCHAR(100) NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS required_authority TEXT NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS resolved_unit_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS resolved_position_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS structural_holder_id INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS acting_approver_id INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS delegation_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(30) NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshot_steps ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS policy_id BIGINT NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS policy_version_id BIGINT NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS generation_number INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS generation_reason TEXT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS supersedes_snapshot_id BIGINT;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS facts_snapshot JSONB NOT NULL;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS route_generation_context JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS generated_by INTEGER;
-- Column source: sql/manual/032_approval_engine_operationalization_phase1.sql
ALTER TABLE public.approval_route_snapshots ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS generic_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS product_identifier TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS manufacturer TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS manufacturer_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS product_description TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS manufacturer_part_number TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS normalized_manufacturer_part_number TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS model TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS technical_specifications JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS package_configuration TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS package_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_quantity > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS product_uom TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS product_uom_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS inventory_conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (inventory_conversion_factor > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS regulatory_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS certifications JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','pending','approved','rejected','retired'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS is_preferred BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS effective_from DATE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS effective_to DATE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS technical_notes TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS approved_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.approved_products ADD COLUMN IF NOT EXISTS institute_id integer;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS spare_part_code TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS name TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS generic_item_id BIGINT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS preferred_approved_product_id BIGINT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS manufacturer_name TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS oem_part_number TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS manufacturer_part_number TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS drawing_number TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS revision TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS technical_specification TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS spare_part_type TEXT NOT NULL CHECK (spare_part_type ~ '^[A-Z][A-Z0-9_]{1,63}$');
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS criticality TEXT NOT NULL CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS failure_consequence TEXT NOT NULL CHECK (failure_consequence IN ('PATIENT_SAFETY','EQUIPMENT_SHUTDOWN','SERVICE_DEGRADATION','MAINTENANCE_EFFICIENCY','NON_CRITICAL'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS interchangeability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (interchangeability_status IN ('EXACT','INTERCHANGEABLE','CONDITIONAL','NOT_INTERCHANGEABLE','UNKNOWN'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS is_repairable BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS is_serialized BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS is_consumable BOOLEAN NOT NULL DEFAULT true;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS is_safety_critical BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS recommended_stocking_policy TEXT NOT NULL DEFAULT 'ORDER_ON_DEMAND' CHECK (recommended_stocking_policy IN ('DO_NOT_STOCK','NORMAL_STOCK','SAFETY_STOCK','STRATEGIC_STOCK','ORDER_ON_DEMAND'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS recommended_min_quantity NUMERIC;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS recommended_max_quantity NUMERIC;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS recommended_safety_stock NUMERIC;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS typical_lead_time_days INTEGER;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS estimated_annual_consumption NUMERIC;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS storage_conditions TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS technical_approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (technical_approval_status IN ('DRAFT','UNDER_REVIEW','APPROVED','CONDITIONALLY_APPROVED','REJECTED'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS technical_approved_by INTEGER;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS technical_approved_at TIMESTAMPTZ;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS technical_approval_reason TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS created_by INTEGER NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS updated_by INTEGER NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0);
-- Column source: sql/manual/023_spare_part_stock_item_integration.sql
ALTER TABLE public.approved_spare_parts ADD COLUMN IF NOT EXISTS stock_item_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS code varchar(40) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS name varchar(160) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS description text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS parent_category_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS created_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS updated_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS asset_tag_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS rfid_business_event_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS exception_type varchar(40) NOT NULL CHECK(exception_type IN('UNAUTHORIZED_MOVEMENT','UNKNOWN_TAG','LOCATION_MISMATCH','MISSING_ASSET','DUPLICATE_SERIAL_REVIEW','RFID_CONFIGURATION'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS severity varchar(20) NOT NULL CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS detected_at timestamptz NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS acknowledged_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS resolved_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS resolution_notes text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_exceptions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS session_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS description text NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS manufacturer text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS model text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS serial_number text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS observed_location_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS department_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS condition_observed varchar(30);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS discovered_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS discovered_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS registered_asset_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_discoveries ADD COLUMN IF NOT EXISTS registered_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS session_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS asset_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS asset_number_snapshot varchar(60) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS description_snapshot text NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS category_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS category_name_snapshot text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_location_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_location_name_snapshot text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_department_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_department_name_snapshot text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_section_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_section_name_snapshot text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_custodian_user_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_custodian_name_snapshot text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS operational_status_snapshot varchar(30) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS condition_snapshot varchar(30) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS expected_rfid_epc_snapshot varchar(128);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_expected_assets ADD COLUMN IF NOT EXISTS snapshot_at timestamptz NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS session_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS expected_asset_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS observation_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS discovery_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS finding_type varchar(40) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS severity varchar(20) NOT NULL DEFAULT 'MEDIUM' CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS acknowledged_by integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS resolved_by integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS resolution_code varchar(60);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_findings ADD COLUMN IF NOT EXISTS resolution_notes text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_number_allocators ADD COLUMN IF NOT EXISTS institute_id integer ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_number_allocators ADD COLUMN IF NOT EXISTS next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_number_allocators ADD COLUMN IF NOT EXISTS prefix varchar(20) NOT NULL DEFAULT 'WICI-FAI';
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS session_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_identifier text NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observation_method varchar(20) NOT NULL CHECK(observation_method IN('MANUAL','QR','RFID'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_location_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_department_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_custodian_user_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_at timestamptz NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS observed_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS rfid_read_event_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS rfid_business_event_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS condition_observed varchar(30);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS operational_status_observed varchar(30);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS raw_evidence jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS dedupe_key text NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_observations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS finding_id bigint NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS from_status varchar(20) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS to_status varchar(20) NOT NULL CHECK(to_status IN('ACKNOWLEDGED','RESOLVED','DISMISSED'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS resolution_code varchar(60);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS resolution_notes text NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS business_object_type varchar(50);
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS business_object_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_resolutions ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS session_number varchar(80) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS name varchar(200) NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS description text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS scope_type varchar(30) NOT NULL CHECK(scope_type IN('LOCATION','DEPARTMENT','FULL_INSTITUTE'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS scope_location_id bigint;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS scope_department_id integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS include_descendants boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','OPEN','COUNTING','REVIEW','COMPLETED','CANCELLED'));
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS started_by integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS counting_started_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS review_started_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS completed_by integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS cancelled_by integer;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS cancellation_reason text;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS updated_by integer NOT NULL;
-- Column source: sql/manual/030_fixed_asset_physical_inventory.sql
ALTER TABLE public.asset_inventory_sessions ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS code varchar(40) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS name varchar(160) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS location_type varchar(30) NOT NULL CHECK(location_type IN('CAMPUS','BUILDING','FLOOR','DEPARTMENT_AREA','SECTION_AREA','ROOM','STORE','WORKSHOP','EXTERNAL','OTHER'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS parent_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS department_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS section_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS created_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS updated_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_locations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS asset_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS from_department_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS from_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS to_department_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS to_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS movement_type varchar(40) NOT NULL CHECK(movement_type IN('PERMANENT_TRANSFER','TEMPORARY_LOAN','MAINTENANCE_TRANSFER','EXTERNAL_MAINTENANCE','RETURN','STORAGE_TRANSFER','DISPOSAL_TRANSFER','LOCATION_CORRECTION'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS requested_by integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS approved_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS dispatched_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS received_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS approved_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS received_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS expected_return_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS actual_return_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS reason text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','IN_TRANSIT','RECEIVED','RETURNED','CANCELLED','REJECTED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/028_asset_movement_operational_hardening.sql
ALTER TABLE public.asset_movements ADD COLUMN IF NOT EXISTS origin_movement_id bigint NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_number_allocators ADD COLUMN IF NOT EXISTS institute_id integer ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_number_allocators ADD COLUMN IF NOT EXISTS next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_number_allocators ADD COLUMN IF NOT EXISTS prefix varchar(20) NOT NULL DEFAULT 'WICI-A';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS asset_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS tag_type varchar(20) NOT NULL CHECK(tag_type IN('RFID_UHF','RFID_HF','QR','BARCODE','OTHER'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS epc varchar(128);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS tid varchar(256);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS qr_value text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS tag_status varchar(30) NOT NULL CHECK(tag_status IN('PENDING_ENCODING','ACTIVE','DAMAGED','LOST','RETIRED','REPLACED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS installed_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS installed_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS retired_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS retired_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS replacement_reason text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.asset_tags ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_number varchar(60) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_class varchar(20) NOT NULL CHECK(asset_class IN('CAPITAL','CONTROLLED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_category_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS description text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS generic_item_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS approved_product_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS stock_item_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS manufacturer text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS model text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS serial_number text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS finance_asset_number text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS acquisition_method varchar(30) NOT NULL CHECK(acquisition_method IN('PURCHASE','DONATION','TRANSFER_IN','LEASE','LOAN','LEGACY','OTHER'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS purchase_request_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS requested_item_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS purchase_order_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS purchase_order_item_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS goods_receipt_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS goods_receipt_item_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS supplier_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS acquisition_date date;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS acquisition_cost numeric(20,4) CHECK(acquisition_cost>=0);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS currency char(3);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS capitalization_status varchar(30) NOT NULL DEFAULT 'NOT_ASSESSED';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ownership_type varchar(30) NOT NULL CHECK(ownership_type IN('INSTITUTE_OWNED','LEASED','SUPPLIER_OWNED','LOANED','DONATED','OTHER'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS owner_name text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS responsible_department_id integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS current_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS condition varchar(30) NOT NULL CHECK(condition IN('NEW','GOOD','FAIR','DAMAGED','UNDER_REPAIR','UNSERVICEABLE','UNKNOWN'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS operational_status varchar(30) NOT NULL CHECK(operational_status IN('IN_SERVICE','IN_STORAGE','UNDER_MAINTENANCE','OUT_OF_SERVICE','MISSING','RETIRED','DISPOSED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS reconciliation_status varchar(20) NOT NULL CHECK(reconciliation_status IN('VERIFIED','UNVERIFIED','MISMATCH','MISSING','UNKNOWN'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS warranty_expiry date;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS creation_source varchar(30) NOT NULL CHECK(creation_source IN('PROCUREMENT','LEGACY_RECOVERY','IMPORT','MANUAL','SYSTEM'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS created_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_by integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS responsible_section_id integer NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS deployment_date date NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS acquisition_currency varchar(3) NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS exchange_rate_to_iqd numeric(24,6) NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS acquisition_amount_iqd numeric(24,0) NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS exchange_rate_effective_date date NULL;
-- Column source: sql/manual/029_fixed_asset_deployment_valuation.sql
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS exchange_rate_source text NULL;
-- Column source: utils/ensureFinanceCoreTables.js:36
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS document_id BIGINT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS document_version_id BIGINT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending';
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS provider TEXT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS model TEXT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_parties JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_dates JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_value JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_payment_terms JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_renewal_clause JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_termination_clause JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_obligations JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS extracted_risks JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS summary TEXT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,2);
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS raw_json JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS error_message TEXT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3743
ALTER TABLE public.contract_ai_extractions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS alert_type TEXT NOT NULL;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS threshold_value TEXT;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS metadata JSONB;
-- Column source: controllers/contractsController.js:995
ALTER TABLE public.contract_alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS amendment_number INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS amendment_date DATE;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS change_summary TEXT;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS revised_value NUMERIC(14,2);
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS revised_expiry DATE;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS approved_by INTEGER;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS snapshot JSONB;
-- Column source: controllers/contractsController.js:981
ALTER TABLE public.contract_amendments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:1024
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS workflow_level INTEGER NOT NULL DEFAULT 1;
-- Column source: controllers/contractsController.js:1025
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS is_active_level BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1026
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS reviewer_role TEXT;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS reviewer_id INTEGER;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS decision TEXT;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS comments TEXT;
-- Column source: controllers/contractsController.js:1030
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
-- Column source: controllers/contractsController.js:1007
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1031
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1027
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS approval_level INTEGER NOT NULL DEFAULT 1;
-- Column source: controllers/contractsController.js:1028
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
-- Column source: controllers/contractsController.js:1029
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractsController.js:1032
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS reviewer_department_id INTEGER;
-- Column source: controllers/contractsController.js:1033
ALTER TABLE public.contract_approvals ADD COLUMN IF NOT EXISTS review_sections JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS clause_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS custom_override_content TEXT;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1;
-- Column source: controllers/contractGovernanceController.js:63
ALTER TABLE public.contract_clause_assignments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS clause_type TEXT;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS clause_title TEXT NOT NULL;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS clause_content TEXT NOT NULL;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS clause_version INTEGER NOT NULL DEFAULT 1;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS language TEXT;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:50
ALTER TABLE public.contract_clauses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS source_id BIGINT;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS consumption_date DATE NOT NULL DEFAULT CURRENT_DATE;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IQD';
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS invoice_id BIGINT;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:3797
ALTER TABLE public.contract_consumption ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS document_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS file_name TEXT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS file_url TEXT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS storage_path TEXT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS mime_type TEXT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS file_size BIGINT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS checksum TEXT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS uploaded_by BIGINT;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractsController.js:1123
ALTER TABLE public.contract_document_versions ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS title TEXT;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS current_version_id BIGINT;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1109
ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS contract_id integer NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS equipment_id bigint NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS coverage_type text NOT NULL CHECK (coverage_type IN ('WARRANTY','PREVENTIVE','CORRECTIVE','COMPREHENSIVE','CALIBRATION','SOFTWARE_SUPPORT','OTHER'));
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS coverage_start date NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS coverage_end date NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS pm_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS corrective_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS labor_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS parts_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS consumables_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS travel_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS software_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS calibration_included boolean NOT NULL DEFAULT false;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS response_time_hours numeric(10,2);
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS resolution_time_hours numeric(10,2);
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS uptime_target_percent numeric(5,2);
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS coverage_limit numeric(20,4);
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS currency char(3);
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS updated_by integer NOT NULL;
-- Column source: sql/manual/021_contract_equipment_coverage.sql
ALTER TABLE public.contract_equipment_coverage ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.contract_evaluations ADD COLUMN IF NOT EXISTS total_score numeric;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS contract_id BIGINT;
-- Column source: controllers/contractsController.js:3775
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS supplier_id BIGINT;
-- Column source: controllers/contractsController.js:3776
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT;
-- Column source: controllers/contractsController.js:3777
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS invoice_date DATE;
-- Column source: controllers/contractsController.js:3778
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
-- Column source: controllers/contractsController.js:3779
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS received_date DATE;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IQD';
-- Column source: controllers/contractsController.js:3780
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3781
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3782
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS retention_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3783
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3784
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS net_payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3785
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
-- Column source: controllers/contractsController.js:3786
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS matching_status TEXT NOT NULL DEFAULT 'not_checked';
-- Column source: controllers/contractsController.js:3787
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS matching_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: controllers/contractsController.js:3788
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:3789
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS document_id BIGINT;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:3774
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3790
ALTER TABLE public.contract_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/requests/createRequestController.js:66
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS item_id INTEGER;
-- Column source: sql/manual/022_contract_item_master_identity.sql
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS generic_item_id bigint;
-- Column source: sql/manual/022_contract_item_master_identity.sql
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS approved_product_id bigint;
-- Column source: sql/manual/022_contract_item_master_identity.sql
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id bigint;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS item_name TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS generic_name TEXT;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS brand_name TEXT;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS unit TEXT;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS contracted_price NUMERIC(14,2);
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS currency TEXT;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC(14,2);
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS warranty_terms TEXT;
-- Column source: controllers/requests/createRequestController.js:67
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(14,2);
-- Column source: controllers/requests/createRequestController.js:68
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS delivered_quantity NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS price_valid_from DATE;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS price_valid_to DATE;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1034
ALTER TABLE public.contract_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS reviewer_id INTEGER;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS legal_risk_level TEXT;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS flagged_clauses JSONB;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS approved_clauses JSONB;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS comments TEXT;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS governing_law TEXT;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS approved BOOLEAN;
-- Column source: controllers/contractGovernanceController.js:116
ALTER TABLE public.contract_legal_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS action TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS actor_id INTEGER;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS details JSONB;
-- Column source: controllers/contractsController.js:1077
ALTER TABLE public.contract_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS negotiation_round INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS discussion_summary TEXT;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS requested_changes JSONB;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS approved_changes JSONB;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS rejected_changes JSONB;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS negotiated_value NUMERIC(14,2);
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS negotiated_terms JSONB;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: controllers/contractGovernanceController.js:102
ALTER TABLE public.contract_negotiations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS obligation_type TEXT NOT NULL DEFAULT 'general';
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS title TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: controllers/contractGovernanceController.js:72
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS responsible_party TEXT;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS due_date DATE;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS completion_notes TEXT;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Column source: controllers/contractGovernanceController.js:72
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS proof_attachment_id INTEGER;
-- Column source: controllers/contractsController.js:1170
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:1198
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1197
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1188
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;
-- Column source: controllers/contractsController.js:1189
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS owner_department_id BIGINT;
-- Column source: controllers/contractsController.js:1190
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';
-- Column source: controllers/contractsController.js:1191
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER;
-- Column source: controllers/contractsController.js:1192
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS next_due_date DATE;
-- Column source: controllers/contractsController.js:1193
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS evidence_required BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractsController.js:1194
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS evidence_document_id BIGINT;
-- Column source: controllers/contractsController.js:1195
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
-- Column source: controllers/contractsController.js:1196
ALTER TABLE public.contract_obligations ADD COLUMN IF NOT EXISTS completed_by BIGINT;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS contract_id BIGINT;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(18,2) NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IQD';
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS payment_date DATE;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:3791
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3792
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS invoice_id BIGINT;
-- Column source: controllers/contractsController.js:3793
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS payment_reference TEXT;
-- Column source: controllers/contractsController.js:3794
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS method TEXT;
-- Column source: controllers/contractsController.js:3795
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
-- Column source: controllers/contractsController.js:3796
ALTER TABLE public.contract_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS renewal_type TEXT;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS renewal_date DATE;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS notice_days INTEGER NOT NULL DEFAULT 90;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS alert_date DATE;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS decision TEXT;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS decision_notes TEXT;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS decided_by BIGINT;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS created_by BIGINT;
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1181
ALTER TABLE public.contract_renewal_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS is_uploaded BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS attachment_id INTEGER;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:1064
ALTER TABLE public.contract_required_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS contract_id BIGINT NOT NULL;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low';
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS assessed_by BIGINT;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS assessment_source TEXT NOT NULL DEFAULT 'system';
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractsController.js:3742
ALTER TABLE public.contract_risk_assessments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS event_type TEXT;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS resolution_time_minutes INTEGER;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS target_response_minutes INTEGER;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS target_resolution_minutes INTEGER;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS breached BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/contractGovernanceController.js:89
ALTER TABLE public.contract_sla_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS template_name TEXT NOT NULL;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS contract_category TEXT;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS contract_type TEXT;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS default_currency TEXT;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS default_sections JSONB;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS default_clauses JSONB;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS default_alert_rules JSONB;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:35
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS contract_id INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS change_summary TEXT;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: controllers/contractGovernanceController.js:142
ALTER TABLE public.contract_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS request_id INTEGER NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS requested_item_id INTEGER NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS department_id INTEGER NOT NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS section_id INTEGER NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS created_by INTEGER NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS department_response TEXT NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS next_follow_up_date DATE NULL;
-- Column source: utils/ensureDepartmentItemFollowUpNotesTable.js:8
ALTER TABLE public.department_item_follow_up_notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS institute_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS department_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS department_rank INTEGER NOT NULL CHECK (department_rank > 0);
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS department_rank_total INTEGER NOT NULL CHECK (department_rank_total >= department_rank);
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS ranked_by BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS ranked_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.department_priority_rankings ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS key TEXT ;
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS logo_data TEXT;
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS document_code VARCHAR(80);
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS template_data TEXT;
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/migrations/20260929_document_branding.sql
ALTER TABLE public.document_branding_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS id serial ;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS title text NOT NULL;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS description text;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS assigned_to integer NOT NULL;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS assigned_by integer NOT NULL;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS employee_update text;
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS assigned_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/development/20261005_02_employee_tasks.sql
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS source_generic_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS target_generic_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'merge_pending' CHECK (status IN ('merge_pending','completed','rejected'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS merge_reason TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS conflict_details JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS reviewed_by INTEGER NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_item_merges ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS item_code TEXT NOT NULL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS generic_name TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS canonical_description TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS subcategory TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS specification JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS base_uom TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS inventory_uom TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS purchasing_uom TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS conversion_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS storage_requirements JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS criticality TEXT NOT NULL DEFAULT 'routine' CHECK (criticality IN ('routine','essential','critical','life_sustaining'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS hazard_information JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS is_sterile BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS expiry_controlled BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS batch_controlled BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS serial_controlled BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','review','validation','approval','active','retired'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS standardization_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (standardization_status IN ('unreviewed','standard','restricted','exception'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS interchangeability_policy TEXT NOT NULL DEFAULT 'approval_required' CHECK (interchangeability_policy IN ('fully_interchangeable','conditionally_interchangeable','non_interchangeable','proprietary','approval_required'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS is_proprietary BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS structured_fingerprint TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS category_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS base_uom_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS inventory_uom_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS purchasing_uom_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS approved_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.generic_items ADD COLUMN IF NOT EXISTS institute_id integer;
-- Column source: utils/ensureFinanceCoreTables.js:76
ALTER TABLE public.gl_postings ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS cycle_count_id bigint NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS stock_item_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS warehouse_stock_level_id integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS system_quantity numeric NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS counted_quantity numeric;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS variance numeric;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS counted_by integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS counted_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS posted_movement_id integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_count_lines ADD COLUMN IF NOT EXISTS posted_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS warehouse_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS status text NOT NULL CHECK(status IN('OPEN','COUNTING','REVIEW','APPROVED','POSTED'));
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS opened_by integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS reviewed_by integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS posted_by integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS posted_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_cycle_counts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS reservation_id bigint NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS warehouse_stock_level_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS reserved_quantity numeric NOT NULL CHECK(reserved_quantity>0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS consumed_quantity numeric NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS released_quantity numeric NOT NULL DEFAULT 0 CHECK(released_quantity>=0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_allocations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS reservation_id bigint NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>'');
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS requested_quantity numeric NOT NULL CHECK(requested_quantity>0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS inventory_movement_id integer NOT NULL ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservation_issue_operations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS warehouse_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS stock_item_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS document_type text NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS document_id text NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS document_line_id text;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL CHECK(quantity>0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS status text NOT NULL CHECK(status IN('ACTIVE','RELEASED','CONSUMED','EXPIRED','CANCELLED'));
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL  CHECK(btrim(idempotency_key)<>'');
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS released_by integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS released_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS consumed_by integer;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS consumed_quantity numeric NOT NULL DEFAULT 0;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS inventory_transaction_id integer NOT NULL;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS warehouse_stock_level_id integer;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS warehouse_id integer NOT NULL;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS stock_item_id integer NOT NULL;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS stock_status text NOT NULL CHECK (stock_status IN ('AVAILABLE','QUARANTINE','BLOCKED','RECALLED','DAMAGED','EXPIRED'));
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL CHECK (quantity <> 0);
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS batch_number text;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS lot_number text;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS serial_number text;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS expiry_date date;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS base_uom text NOT NULL;
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS allocation_sequence integer NOT NULL CHECK (allocation_sequence > 0);
-- Column source: sql/manual/004_inventory_transaction_engine.sql
ALTER TABLE public.inventory_transaction_allocations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS transfer_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS transfer_line_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS dispatch_movement_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS dispatch_allocation_id bigint NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS dispatched_quantity numeric NOT NULL CHECK(dispatched_quantity>0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS received_quantity numeric NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=dispatched_quantity);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_allocation_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS transfer_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS transfer_line_id integer NOT NULL ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS dispatch_movement_id integer NOT NULL ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS receipt_movement_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS dispatched_quantity numeric NOT NULL CHECK(dispatched_quantity>0);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS received_quantity numeric NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=dispatched_quantity);
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_movement_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS transfer_id integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>'');
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS receipt_movement_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/005_inventory_operations.sql
ALTER TABLE public.inventory_transfer_receipt_operations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS invoice_match_result_id BIGINT NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL CHECK (decision IN ('APPROVED','DECLINED'));
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS actor_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS original_variances JSONB NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.invoice_match_override_decisions ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL CHECK (entity_type IN ('generic_item','approved_product','supplier_catalog_item'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS source_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS candidate_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS score NUMERIC(5,4) NOT NULL CHECK (score >= 0 AND score <= 1);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS matching_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','duplicate','not_duplicate','merged'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS review_notes TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_duplicate_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS generic_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS alias_type TEXT NOT NULL CHECK (alias_type IN ('legacy_name','legacy_code','request_snapshot','merged_item'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS alias_value TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS normalized_alias TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS source_table TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS source_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_aliases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS entity_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS action TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS actor_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS reason TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS previous_values JSONB;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS new_values JSONB;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS request_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS requested_item_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS source_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS target_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS organizational_context JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.item_master_audit_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: backend-query-derived-contract
ALTER TABLE public.item_uom ADD COLUMN IF NOT EXISTS name text GENERATED ALWAYS AS (uom_name) STORED;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS request_id INTEGER;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS journal_type TEXT NOT NULL CHECK (journal_type IN ('ap_voucher', 'payment', 'adjustment', 'accrual', 'manual'));
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS source_id TEXT;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS journal_reference TEXT NOT NULL ;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS entry_status TEXT NOT NULL DEFAULT 'posted';
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS posted_by INTEGER;
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureFinanceCoreTables.js:50
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT NOT NULL;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS line_no INTEGER NOT NULL;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS account_code TEXT NOT NULL;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS cost_center_id INTEGER;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS description TEXT;
-- Column source: utils/ensureFinanceCoreTables.js:64
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS source_table TEXT NOT NULL CHECK (source_table IN ('item_master','item_master_items'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS legacy_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS generic_item_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS legacy_code_snapshot TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS legacy_name_snapshot TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'active' CHECK (mapping_status IN ('active','superseded','rejected'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS mapping_reason TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS mapped_by INTEGER NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.legacy_item_mappings ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS equipment_code TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS name TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS manufacturer TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS model TEXT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS serial_number TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS department_id INTEGER;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/019_asset_equipment_integration.sql
ALTER TABLE public.maintainable_equipment ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS work_order_part_id bigint NOT NULL;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS operation_type text NOT NULL CHECK(operation_type IN('RESERVE','ISSUE','RELEASE','RETURN'));
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS quantity numeric(18,6) NOT NULL CHECK(quantity>0);
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS reservation_id bigint;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS inventory_movement_id integer;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_part_inventory_operations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_allocators ADD COLUMN IF NOT EXISTS institute_id integer ;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_allocators ADD COLUMN IF NOT EXISTS next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0);
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS work_order_id bigint NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS spare_part_id bigint NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS stock_item_id integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS quantity_planned numeric(18,6) NOT NULL CHECK(quantity_planned>0);
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS quantity_used numeric(18,6) NOT NULL DEFAULT 0 CHECK(quantity_used>=0);
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'PLANNED' CHECK(action IN('PLANNED','RESERVED','ISSUED','INSTALLED','REMOVED','RETURNED_UNUSED','RETURNED_FOR_REPAIR','SCRAPPED'));
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS installed_serial_number text;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS removed_serial_number text;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS notes text;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS reservation_id bigint;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS issued_inventory_movement_id integer;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
-- Column source: sql/manual/025_maintenance_inventory_execution.sql
ALTER TABLE public.maintenance_work_order_parts ADD COLUMN IF NOT EXISTS issued_at timestamptz;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS work_order_number text NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS equipment_id bigint NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS coverage_id bigint;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS work_order_type text NOT NULL CHECK(work_order_type IN('CORRECTIVE','PREVENTIVE','CALIBRATION','INSPECTION','INSTALLATION','OTHER'));
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS priority text NOT NULL CHECK(priority IN('CRITICAL','HIGH','MEDIUM','LOW'));
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED'));
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS problem_description text NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS failure_code text;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS resolution_summary text;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS started_at timestamptz;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS downtime_started_at timestamptz;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS downtime_ended_at timestamptz;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS assigned_to integer;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS created_by integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS updated_by integer NOT NULL;
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/024_maintenance_work_orders.sql
ALTER TABLE public.maintenance_work_orders ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS event_type text NOT NULL;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS entity_type text NOT NULL;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS entity_id text NOT NULL;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS recipient_user_id integer;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed'));
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0);
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS processed_at timestamptz;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS last_error text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS organization_unit_id BIGINT NOT NULL;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS organization_head_position_id BIGINT NOT NULL;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS organization_head_user_id INTEGER NOT NULL;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS decision VARCHAR(40) NOT NULL CONSTRAINT organization_head_reconciliation_decision_check CHECK (decision IN ('KEEP_EXISTING','MARK_LEGACY_OBSOLETE'));
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL CONSTRAINT organization_head_reconciliation_reason_check CHECK (length(trim(reason)) > 0);
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS decided_by INTEGER NOT NULL;
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
ALTER TABLE public.organization_head_reconciliation_decisions ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS organization_unit_id BIGINT NOT NULL;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS position_type VARCHAR(30) NOT NULL CHECK (position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD','CUSTOM'));
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS position_name VARCHAR(255) NOT NULL;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS user_id INTEGER;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS is_unit_head BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS effective_from DATE;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS effective_to DATE;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_positions ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS code VARCHAR(100);
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS unit_type VARCHAR(30) NOT NULL CHECK (unit_type IN ('INSTITUTE','EXECUTIVE_OFFICE','DIRECTORATE','DEPARTMENT','SECTION','UNIT'));
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS parent_unit_id BIGINT;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS department_id INTEGER ;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS section_id INTEGER ;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS classification VARCHAR(50);
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/manual/014_organization_hierarchy.sql
ALTER TABLE public.organization_units ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS request_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS requested_item_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS proposed_name TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS category TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS required_specifications JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS intended_use TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(18,6) CHECK (requested_quantity IS NULL OR requested_quantity > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS requested_uom TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS justification TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','review','needs_information','mapped_existing','approved_exception','rejected','resolved'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolution_type TEXT CHECK (resolution_type IS NULL OR resolution_type IN ('existing_generic','existing_product','supplier_catalog_only','new_generic_draft','approved_free_text_exception','rejected','needs_information'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolved_generic_item_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolved_product_id BIGINT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS requester_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS assigned_steward_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolved_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.pending_item_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS warehouse_id BIGINT NULL;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS forecast_horizon_months INTEGER NOT NULL DEFAULT 6;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS forecast_window_size INTEGER NOT NULL DEFAULT 3;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS safety_lead_time_days INTEGER NOT NULL DEFAULT 14;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS safety_review_period_days INTEGER NOT NULL DEFAULT 7;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS demand_history_days INTEGER NOT NULL DEFAULT 120;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS demand_history_months INTEGER NOT NULL DEFAULT 12;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS safety_history_days INTEGER NOT NULL DEFAULT 180;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS mrp_horizon_days INTEGER NOT NULL DEFAULT 84;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS mrp_bucket_days INTEGER NOT NULL DEFAULT 7;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS updated_by BIGINT NULL;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: controllers/demandPlanningController.js:240
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS requester_id INTEGER NOT NULL;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS department_id INTEGER;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS section_id INTEGER;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS form_name TEXT NOT NULL;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL CHECK (quantity > 0);
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted';
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS accepted_by INTEGER;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS completed_by INTEGER;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_settings ADD COLUMN IF NOT EXISTS key TEXT ;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_settings ADD COLUMN IF NOT EXISTS value TEXT;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: routes/printServiceRequests.js:14
ALTER TABLE public.print_service_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS request_item_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS supplier_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS awarded_quantity NUMERIC(18,4) NOT NULL CHECK (awarded_quantity > 0);
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0);
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL CHECK (source_type IN ('QUOTATION','CONTRACT','FRAMEWORK_AGREEMENT','DIRECT_PURCHASE','MANUAL_EXCEPTION'));
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS source_id BIGINT;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS selection_reason TEXT NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS actor_id INTEGER;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','SUPERSEDED'));
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL ;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS payload_fingerprint CHAR(64) NOT NULL;
-- Column source: sql/manual/009_phase5a2_uom_authority.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS approved_product_id BIGINT;
-- Column source: sql/manual/009_phase5a2_uom_authority.sql
ALTER TABLE public.procurement_awards ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS activity_at TIMESTAMPTZ NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS actor_id INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS related_entity_id TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS source TEXT NOT NULL CHECK (source IN ('SYSTEM','MANUAL','OUTBOX','LEGACY'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_activities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS factor_code TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS factor_value TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS points SMALLINT NOT NULL CHECK (points BETWEEN 1 AND 10);
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS assessed_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS assessed_by INTEGER NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_case_complexity_factors ADD COLUMN IF NOT EXISTS assessment_reason TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS requested_item_id INTEGER NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS institute_id INTEGER NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS department_id INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS assigned_buyer_id INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS case_status TEXT NOT NULL CHECK (case_status IN ('APPROVAL_PENDING','ITEM_IDENTITY_RESOLUTION','READY_FOR_SOURCING','SOURCING','AWAITING_QUOTATION','TECHNICAL_EVALUATION','COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING','SUPPLIER_FULFILLMENT','LOGISTICS','DELIVERED','CLOSED'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS sourcing_method TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS pending_root_cause TEXT CHECK (pending_root_cause IS NULL OR pending_root_cause IN ('ITEM_IDENTITY_RESOLUTION','SUPPLY_CHAIN_SOURCING','AWAITING_TECHNICAL_EVALUATION','AWAITING_SUPPLIER_QUOTATION','AWAITING_FINANCE_PAYMENT','SUPPLIER_MANUFACTURING','INTERNATIONAL_SHIPMENT','CUSTOMS_REGULATORY','END_USER_CLARIFICATION','APPROVAL_PENDING','OTHER'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS pending_override_reason TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS sourcing_started_at TIMESTAMPTZ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS commercially_ready_at TIMESTAMPTZ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS complexity_score SMALLINT CHECK (complexity_score BETWEEN 1 AND 100);
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS complexity_class CHAR(1) CHECK (complexity_class IN ('A','B','C','D','E'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS complexity_model_version TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS workload_units SMALLINT CHECK (workload_units IN (1,2,4,7,10));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS workload_model_version TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS existing_supplier BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS sole_source BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS oem_only BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS international_procurement BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS discontinued_or_obsolete BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS alternative_product_investigated BOOLEAN;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS strategic_highlight BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS strategic_summary JSONB;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS activity_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (activity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS complexity_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (complexity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS commercial_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (commercial_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS cycle_time_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (cycle_time_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS logistics_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (logistics_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_cases ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS title text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS description text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS category text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS request_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS department_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS section_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS evaluation_type text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS evaluation_period_years numeric(20,6) DEFAULT 5;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS expected_annual_growth_rate numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS currency text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','In Review','Finalized','Cancelled'));
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS recommendation_summary text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS selected_offer_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS created_by bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS finalized_by bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_cases ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS criteria_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS criteria_group text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS weight numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS scoring_type text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS higher_is_better boolean DEFAULT true;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS is_required boolean DEFAULT true;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS metric_key text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS normalization_method text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS target_value numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS min_value numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS max_value numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS is_knockout boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS required_threshold numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_criteria ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS unit_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS offer_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS test_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS pricing_method text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS element_type text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS quantity numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS annual_quantity numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS dependency_group text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS alternative_group text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS kit_price numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS tests_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS usable_tests_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS open_vial_stability_days numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS onboard_stability_days numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS shelf_life_months numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS expected_waste_percentage numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS repeat_rate_percentage numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS qc_frequency_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS qc_cost_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS calibrator_frequency_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS calibrator_cost_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS fixed_consumable_cost_per_kit numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS other_kit_related_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS price_per_reportable_test numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS company_absorbs_waste boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS company_absorbs_qc boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS company_absorbs_repeats boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS notes text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS calculated_effective_cost_per_reported_test numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS annual_test_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offer_test_costs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS supplier_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS supplier_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS offer_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS manufacturer_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS model_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS country_of_origin text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS pricing_model text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS is_disqualified boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS disqualification_reason text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS compliance_status text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS lease_monthly_payment numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS lease_term_months numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS subscription_base_fee numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS included_volume numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS overage_price numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS sla_penalty_amount numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS uptime_guarantee_percentage numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS downtime_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS supplier_risk_premium numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS stockout_risk_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS fx_risk_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS obsolescence_risk_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS penalty_or_sla_adjustment numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS device_price numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS installation_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS training_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS shipping_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS customs_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS other_initial_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS device_discount_value numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS warranty_years numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS annual_maintenance_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS annual_service_contract_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS annual_fixed_consumables_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS annual_calibration_qc_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS annual_spare_parts_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS expected_lifetime_years numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS delivery_time_days numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS payment_terms text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS minimum_annual_commitment_amount numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS minimum_annual_commitment_tests numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS reagent_rental_terms text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS free_device_included boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS commitment_penalty_terms text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS technical_notes text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS commercial_notes text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS risk_notes text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS technical_model jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS contract_model jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS package_model jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS service_model jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS risk_model jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS scenario_metadata jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS is_compliant boolean DEFAULT true;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_offers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS pricing_model text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS initial_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS annual_fixed_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS annual_variable_test_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS annual_commitment_adjustment numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS total_annual_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS tco_period_cost numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS risk_adjusted_tco numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS average_cost_per_reported_test numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS total_expected_reported_tests numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS cost_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS technical_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS supplier_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS risk_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS final_weighted_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS commitment_volume_shortfall boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS shortfall_tests numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS commitment_warning text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS rank integer;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS compliance_passed boolean DEFAULT true;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS knockout_failed boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS scoring_breakdown jsonb DEFAULT '{}'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS recommendation_reason text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS offer_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_results ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS offer_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS criteria_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS evaluator_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS weighted_score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS raw_value numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS score numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS comments text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_scores ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS evaluation_case_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS test_name text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS test_code text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS category text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS unit text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS expected_monthly_volume numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS growth_rate numeric(20,6) DEFAULT 0;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS is_required boolean DEFAULT true;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS dependency_risk text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS is_alternative boolean DEFAULT false;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS notes text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_evaluation_tests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/development/20261005_03_procurement_identity_policy.sql
ALTER TABLE public.procurement_identity_policy ADD COLUMN IF NOT EXISTS id SMALLINT  CHECK (id=1);
-- Column source: sql/development/20261005_03_procurement_identity_policy.sql
ALTER TABLE public.procurement_identity_policy ADD COLUMN IF NOT EXISTS enforce_item_identity BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: sql/development/20261005_03_procurement_identity_policy.sql
ALTER TABLE public.procurement_identity_policy ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL;
-- Column source: sql/development/20261005_03_procurement_identity_policy.sql
ALTER TABLE public.procurement_identity_policy ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/development/20261005_03_procurement_identity_policy.sql
ALTER TABLE public.procurement_identity_policy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS requested_item_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS procurement_user_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS event_quantity INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS previous_purchased_quantity INTEGER NOT NULL DEFAULT 0;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS new_purchased_quantity INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS remaining_quantity INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2) NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2) NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS supplier_id INTEGER NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS supplier_name TEXT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS procurement_note TEXT NULL;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS procurement_date DATE DEFAULT CURRENT_DATE;
-- Column source: sql/migrations/20260608_procurement_item_events.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/migrations/20261003_procurement_event_overage_decisions.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS overage_decided_by INTEGER;
-- Column source: sql/migrations/20261003_procurement_event_overage_decisions.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS overage_decided_at TIMESTAMP;
-- Column source: sql/migrations/20261003_procurement_event_overage_decisions.sql
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS overage_decision_note TEXT;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS procurement_quantity numeric;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS procurement_unit_of_measure text;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS units_per_package numeric CHECK(units_per_package IS NULL OR units_per_package>0);
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS package_unit_cost numeric;
-- Column source: backend-query-derived-contract
ALTER TABLE public.procurement_item_events ADD COLUMN IF NOT EXISTS overage_approval_status text CHECK(overage_approval_status IS NULL OR overage_approval_status IN ('not_required','pending','approved','rejected'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_group_members ADD COLUMN IF NOT EXISTS group_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_group_members ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_group_members ADD COLUMN IF NOT EXISTS added_by BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_group_members ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_group_members ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS institute_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS name TEXT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS public_title TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS public_description TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS tier_override TEXT CHECK (tier_override IN ('P0','P1','P2','P3','P4'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS tier_override_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS institutional_rank INTEGER;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS institutional_rank_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS created_by BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS updated_by BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS score NUMERIC(5,2) NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL CHECK (tier IN ('P0','P1','P2','P3','P4'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS factor_breakdown JSONB NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS trigger_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS institutional_rank INTEGER;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS calculated_by BIGINT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_history ADD COLUMN IF NOT EXISTS calculated_by_system BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS institute_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS department_id BIGINT NOT NULL;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS coverage_status TEXT NOT NULL DEFAULT 'NEEDS_ASSESSMENT'
    CHECK (coverage_status IN ('PARTIAL','NEEDS_ASSESSMENT','COMPLETE'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS impact_level TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS impact_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS scm_assessment SMALLINT CHECK (scm_assessment BETWEEN 0 AND 100);
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS scm_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS scm_assessed_by BIGINT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS scm_assessed_at TIMESTAMPTZ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS service_risk_level TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS service_risk_override_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS deadline_type TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS deadline_consequence TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS deadline_evidence_reference TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS dependency_level TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS dependency_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS regulatory_level TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS regulatory_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS approved_initiative_id BIGINT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS supply_chain_owned_at TIMESTAMPTZ;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS system_score NUMERIC(5,2);
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS system_tier TEXT CHECK (system_tier IN ('P0','P1','P2','P3','P4'));
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL DEFAULT 'IPPS-1.0';
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS system_suggested_rank INTEGER;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS institutional_rank INTEGER;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS institutional_override_reason TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS p0_justification TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS public_title TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS public_description TEXT;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/012_procurement_priority_foundation.sql
ALTER TABLE public.procurement_priority_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS procurement_case_id BIGINT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS value_type TEXT NOT NULL CHECK (value_type IN ('HARD_SAVINGS','COST_AVOIDANCE'));
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS baseline_type TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS baseline_amount NUMERIC(20,4);
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS final_amount NUMERIC(20,4);
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS verified_value NUMERIC(20,4) NOT NULL CHECK (verified_value >= 0);
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$');
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS evidence_entity_type TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS evidence_entity_id TEXT NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS entered_by INTEGER NOT NULL;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS verified_by INTEGER;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
-- Column source: sql/manual/010_supply_chain_performance_foundation.sql
ALTER TABLE public.procurement_value_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: utils/ensureProjectsTable.js:36
ALTER TABLE public.project_department_visibility ADD COLUMN IF NOT EXISTS project_id UUID NOT NULL;
-- Column source: utils/ensureProjectsTable.js:36
ALTER TABLE public.project_department_visibility ADD COLUMN IF NOT EXISTS department_id INTEGER NOT NULL;
-- Column source: utils/ensureProjectsTable.js:36
ALTER TABLE public.project_department_visibility ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
-- Column source: backend-query-derived-contract
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS contract_id integer;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS request_type VARCHAR(100) NOT NULL;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS warehouse_id INTEGER NULL;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER NOT NULL;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS created_by INTEGER NULL;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS updated_by INTEGER NULL;
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureRequestAutoAssignmentRulesTable.js:10
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS request_id INTEGER NOT NULL;
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS approval_id INTEGER;
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS requested_by INTEGER;
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Pending';
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL;
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: utils/ensureRequestEditApprovalsTable.js:4
ALTER TABLE public.request_edit_approvals ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS reader_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS antenna_port integer NOT NULL CHECK(antenna_port>0);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS name text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS antenna_type text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS configuration jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_antennas ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS event_type varchar(30) NOT NULL CHECK(event_type IN('ASSET_SEEN','LOCATION_VERIFIED','PORTAL_ENTRY','PORTAL_EXIT','AUTHORIZED_MOVEMENT','UNAUTHORIZED_MOVEMENT','UNKNOWN_TAG'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS asset_tag_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS epc varchar(128) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS portal_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS reader_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS from_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS to_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS direction varchar(20) NOT NULL CHECK(direction IN('ENTERING','EXITING','UNKNOWN'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL CHECK(observation_count>0);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS confidence_score numeric(5,4) CHECK(confidence_score BETWEEN 0 AND 1);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS authorization_status varchar(20) NOT NULL CHECK(authorization_status IN('AUTHORIZED','UNAUTHORIZED','NOT_APPLICABLE','UNKNOWN'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS related_asset_movement_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'OPEN';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_business_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS client_identifier varchar(100) NOT NULL ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS credential_hash char(64) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['rfid:ingest'];
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_integration_clients ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portal_antennas ADD COLUMN IF NOT EXISTS portal_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portal_antennas ADD COLUMN IF NOT EXISTS antenna_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portal_antennas ADD COLUMN IF NOT EXISTS sequence_group integer;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portal_antennas ADD COLUMN IF NOT EXISTS direction_role varchar(20) NOT NULL DEFAULT 'UNKNOWN' CHECK(direction_role IN('SIDE_A','SIDE_B','APPROACH','DEPARTURE','UNKNOWN'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portal_antennas ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS code varchar(60) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS name text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS portal_type varchar(30) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS from_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS to_location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS configuration jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_portals ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS integration_client_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS epc varchar(128) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS tid varchar(256);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS asset_tag_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS asset_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS reader_id bigint NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS antenna_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS portal_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS rssi smallint CHECK(rssi BETWEEN -120 AND 0);
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS read_timestamp timestamptz NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS source_type varchar(20) NOT NULL CHECK(source_type IN('HANDHELD','FIXED','IMPORT','TEST'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS external_event_id text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS raw_payload jsonb;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS processing_status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(processing_status IN('PENDING','PROCESSING','PROCESSED','FAILED','IGNORED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS processing_error text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS business_event_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS processed_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_read_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS id bigserial ;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS institute_id integer NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS code varchar(60) NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS name text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS reader_type varchar(20) NOT NULL CHECK(reader_type IN('HANDHELD','FIXED'));
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS manufacturer text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS model text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS serial_number text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS device_identifier text NOT NULL;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS firmware_version text;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS ip_address inet;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS location_id bigint;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'OFFLINE';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS configuration jsonb NOT NULL DEFAULT '{}';
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/017_fixed_assets_rfid_core.sql
ALTER TABLE public.rfid_readers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS rfx_response_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS requested_item_id INTEGER NOT NULL;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS quoted_quantity NUMERIC(18,4) NOT NULL CHECK (quoted_quantity > 0);
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS free_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (free_quantity >= 0);
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0);
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$');
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS brand TEXT;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS offered_specs TEXT;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: sql/manual/006_connected_procure_to_pay.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/009_phase5a2_uom_authority.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT;
-- Column source: sql/manual/009_phase5a2_uom_authority.sql
ALTER TABLE public.rfx_response_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT;
-- Column source: utils/capabilityPolicyService.js:5
ALTER TABLE public.route_capability_policies ADD COLUMN IF NOT EXISTS route_prefix TEXT ;
-- Column source: utils/capabilityPolicyService.js:5
ALTER TABLE public.route_capability_policies ADD COLUMN IF NOT EXISTS module TEXT NOT NULL;
-- Column source: utils/capabilityPolicyService.js:5
ALTER TABLE public.route_capability_policies ADD COLUMN IF NOT EXISTS resource TEXT NOT NULL;
-- Column source: utils/capabilityPolicyService.js:5
ALTER TABLE public.route_capability_policies ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';
-- Column source: utils/capabilityPolicyService.js:5
ALTER TABLE public.route_capability_policies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS spare_part_id BIGINT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS equipment_id BIGINT NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS compatibility_type TEXT NOT NULL CHECK (compatibility_type IN ('OEM_SPECIFIED','OEM_CONFIRMED','TECHNICALLY_VERIFIED','APPROVED_EQUIVALENT','CONDITIONAL'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS compatibility_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (compatibility_status IN ('PENDING','APPROVED','REJECTED','INACTIVE'));
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS serial_number_from TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS serial_number_to TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS oem_confirmed BOOLEAN NOT NULL DEFAULT false;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS confirmation_reference TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS technical_notes TEXT;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS approved_by INTEGER;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS created_by INTEGER NOT NULL;
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/manual/013_approved_spare_parts_foundation.sql
ALTER TABLE public.spare_part_equipment_compatibility ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS stock_item_id INTEGER NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS generic_item_id BIGINT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS approved_product_id BIGINT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'proposed' CHECK (mapping_status IN ('proposed','review_required','approved','rejected','superseded','rolled_back','duplicate','obsolete','excluded'));
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS match_method TEXT NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1);
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS proposed_generic_name TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS proposed_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS candidate_details JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_name_snapshot TEXT NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_description_snapshot TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_brand_snapshot TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_category_snapshot TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_subcategory_snapshot TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS original_uom_snapshot TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS previous_identity JSONB;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS review_notes TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_master_mappings ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_stock_item_id INTEGER NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_brand TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_category TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_subcategory TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_uom TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_description TEXT;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_quantity_snapshot NUMERIC;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_cost_snapshot NUMERIC;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS source_checksum TEXT NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS import_batch_id UUID NOT NULL;
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL CHECK(validation_status IN ('valid','invalid','unchanged'));
-- Column source: sql/migrations/phase1b/02_stock_item_mapping_tables.sql
ALTER TABLE public.stock_item_migration_staging ADD COLUMN IF NOT EXISTS validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Column source: backend-query-derived-contract
ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS category_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS manufacturer_id bigint;
-- Column source: backend-query-derived-contract
ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS institute_id integer;
-- Column source: sql/manual/009_phase5a2_uom_authority.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS purchasing_uom_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS id BIGSERIAL ;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_item_code TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_description TEXT;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS purchasing_uom TEXT NOT NULL;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18,6) NOT NULL CHECK (conversion_factor > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS package_size NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_size > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS order_multiple NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (order_multiple > 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18,6) CHECK (unit_price IS NULL OR unit_price >= 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS currency CHAR(3);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(7,4) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS contract_id INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown','available','limited','unavailable','discontinued'));
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS is_preferred_supplier BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS is_approved_supplier BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS effective_from DATE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS effective_to DATE;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS created_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS updated_by INTEGER;
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: sql/migrations/20260727_item_master_foundation.sql
ALTER TABLE public.supplier_catalog_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/suppliersController.js:64
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: controllers/suppliersController.js:64
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS supplier_id INTEGER NOT NULL;
-- Column source: controllers/suppliersController.js:64
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS name TEXT NOT NULL;
-- Column source: controllers/suppliersController.js:80
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS phone_number TEXT;
-- Column source: controllers/suppliersController.js:81
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS email TEXT;
-- Column source: controllers/suppliersController.js:82
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS position TEXT;
-- Column source: controllers/suppliersController.js:83
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS responsibility TEXT;
-- Column source: controllers/suppliersController.js:84
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
-- Column source: controllers/suppliersController.js:85
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
-- Column source: controllers/suppliersController.js:86
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: controllers/suppliersController.js:87
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Column source: backend-query-derived-contract
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS contract_id integer;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS id SERIAL ;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS supplier_id INTEGER NOT NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS principal_name VARCHAR(255) NOT NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS principal_country VARCHAR(120) NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(80) NOT NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorization_status VARCHAR(80) DEFAULT 'Pending Verification';
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorization_start_date DATE NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorization_expiry_date DATE NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorized_categories TEXT[] NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorized_brands TEXT[] NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS authorization_document_url TEXT NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS verification_notes TEXT NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS verified_by INTEGER NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP NULL;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Column source: sql/migrations/20260608_supplier_classification_principals.sql
ALTER TABLE public.supplier_principals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Column source: backend-query-derived-contract
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS institute_id integer;
-- Column source: backend-query-derived-contract
ALTER TABLE public.user_section_assignments ADD COLUMN IF NOT EXISTS user_id integer NOT NULL;
-- Column source: backend-query-derived-contract
ALTER TABLE public.user_section_assignments ADD COLUMN IF NOT EXISTS section_id integer NOT NULL;
-- Column source: backend-query-derived-contract
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- Column source: backend-query-derived-contract
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Index source: sql/manual/033_ai_intelligence_foundation.sql
CREATE INDEX IF NOT EXISTS ai_interactions_institute_created_idx ON public.ai_interactions (institute_id,created_at DESC);
-- Index source: sql/manual/033_ai_intelligence_foundation.sql
CREATE INDEX IF NOT EXISTS ai_interactions_session_idx ON public.ai_interactions (session_id);
-- Index source: sql/manual/033_ai_intelligence_foundation.sql
CREATE INDEX IF NOT EXISTS ai_interactions_user_created_idx ON public.ai_interactions (user_id,created_at DESC);
-- Index source: sql/manual/033_ai_intelligence_foundation.sql
CREATE INDEX IF NOT EXISTS ai_tool_executions_interaction_idx ON public.ai_tool_executions (interaction_id,created_at);
-- Index source: sql/manual/033_ai_intelligence_foundation.sql
CREATE INDEX IF NOT EXISTS ai_tool_executions_tool_created_idx ON public.ai_tool_executions (tool_name,created_at DESC);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS ap_posting_idempotency_uq ON public.finance_postings (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS ap_voucher_idempotency_uq ON public.ap_vouchers (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE INDEX IF NOT EXISTS approval_authority_delegations_delegator_idx ON public.approval_authority_delegations (delegator_user_id) WHERE status='ACTIVE';
-- Index source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE INDEX IF NOT EXISTS approval_authority_delegations_effective_idx ON public.approval_authority_delegations (institute_id,scope,effective_from,effective_to) WHERE status='ACTIVE';
-- Index source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE INDEX IF NOT EXISTS approval_authority_delegations_position_idx ON public.approval_authority_delegations (organization_position_id) WHERE status='ACTIVE';
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS approval_policies_institute_code_uq ON public.approval_policies (institute_id,lower(code));
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS approval_policy_rules_priority_uq ON public.approval_policy_rules (policy_version_id,priority);
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE INDEX IF NOT EXISTS approval_policy_shadow_differences_type_idx ON public.approval_policy_shadow_differences (shadow_run_id,difference_type);
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE INDEX IF NOT EXISTS approval_policy_shadow_runs_lookup_idx ON public.approval_policy_shadow_runs (policy_version_id,generated_at DESC);
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE INDEX IF NOT EXISTS approval_policy_shadow_runs_request_idx ON public.approval_policy_shadow_runs (request_id,generated_at DESC);
-- Index source: sql/manual/015_approval_policy_engine_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS approval_policy_versions_number_uq ON public.approval_policy_versions (approval_policy_id,version_number);
-- Index source: sql/approval_routes.sql
CREATE INDEX IF NOT EXISTS approval_route_rules_lookup_idx ON public.approval_route_rules (version_id, request_type, department_type, approval_level);
-- Index source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE INDEX IF NOT EXISTS approval_route_snapshot_steps_approver_idx ON public.approval_route_snapshot_steps (snapshot_id,acting_approver_id);
-- Index source: sql/manual/032_approval_engine_operationalization_phase1.sql
CREATE INDEX IF NOT EXISTS approval_route_snapshots_request_idx ON public.approval_route_snapshots (institute_id,request_id,generation_number DESC);
-- Index source: sql/approval_routes.sql
CREATE INDEX IF NOT EXISTS approval_routes_lookup_idx ON public.approval_routes (request_type, department_type, approval_level);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS approved_products_generic_idx ON public.approved_products (generic_item_id, approval_status);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS approved_products_identifier_idx ON public.approved_products (product_identifier) WHERE product_identifier IS NOT NULL;
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS approved_spare_parts_filters_idx ON public.approved_spare_parts (institute_id,lifecycle_status,technical_approval_status,criticality);
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS approved_spare_parts_institute_code_uq ON public.approved_spare_parts (institute_id, lower(btrim(spare_part_code)));
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS approved_spare_parts_institute_stocking_idx ON public.approved_spare_parts (institute_id, recommended_stocking_policy);
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS approved_spare_parts_institute_updated_idx ON public.approved_spare_parts (institute_id, updated_at DESC, id DESC);
-- Index source: sql/manual/023_spare_part_stock_item_integration.sql
CREATE INDEX IF NOT EXISTS approved_spare_parts_stock_item_idx ON public.approved_spare_parts (institute_id,stock_item_id) WHERE stock_item_id IS NOT NULL;
-- Index source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE INDEX IF NOT EXISTS asset_inventory_expected_session_idx ON public.asset_inventory_expected_assets (institute_id,session_id);
-- Index source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE INDEX IF NOT EXISTS asset_inventory_findings_filter_idx ON public.asset_inventory_findings (institute_id,session_id,status,finding_type);
-- Index source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE INDEX IF NOT EXISTS asset_inventory_observations_session_asset_idx ON public.asset_inventory_observations (institute_id,session_id,asset_id,observed_at DESC);
-- Index source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_inventory_one_open_finding_uq ON public.asset_inventory_findings (session_id,finding_type,COALESCE(asset_id,0),COALESCE(discovery_id,0)) WHERE status IN('OPEN','ACKNOWLEDGED');
-- Index source: sql/manual/030_fixed_asset_physical_inventory.sql
CREATE INDEX IF NOT EXISTS asset_inventory_sessions_scope_idx ON public.asset_inventory_sessions (institute_id,status,created_at DESC);
-- Index source: sql/manual/028_asset_movement_operational_hardening.sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_movements_one_active_uq ON public.asset_movements (institute_id,asset_id)
    WHERE status IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT');
-- Index source: sql/manual/028_asset_movement_operational_hardening.sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_movements_return_origin_uq ON public.asset_movements (origin_movement_id)
    WHERE movement_type='RETURN';
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_tags_active_epc_uq ON public.asset_tags (institute_id,epc) WHERE epc IS NOT NULL AND tag_status='ACTIVE';
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_tags_primary_uhf_uq ON public.asset_tags (asset_id) WHERE is_primary AND tag_type='RFID_UHF' AND tag_status='ACTIVE';
-- Index source: sql/manual/029_fixed_asset_deployment_valuation.sql
CREATE INDEX IF NOT EXISTS assets_responsible_section_idx ON public.assets (institute_id,responsible_section_id);
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS budget_envelope_contract_uq ON public.budget_envelopes (department_id,project_id,fiscal_year,currency) NULLS NOT DISTINCT;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS commitment_ledger_idempotency_uq ON public.commitment_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: controllers/contractsController.js:3743
CREATE INDEX IF NOT EXISTS contract_ai_extractions_contract_id_idx ON public.contract_ai_extractions (contract_id);
-- Index source: controllers/contractsController.js:3743
CREATE INDEX IF NOT EXISTS contract_ai_extractions_status_idx ON public.contract_ai_extractions (extraction_status);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_consumption_consumption_date_idx ON public.contract_consumption (consumption_date);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_consumption_contract_id_idx ON public.contract_consumption (contract_id);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_consumption_invoice_id_idx ON public.contract_consumption (invoice_id);
-- Index source: controllers/contractsController.js:1138
CREATE INDEX IF NOT EXISTS contract_document_versions_contract_id_idx ON public.contract_document_versions (contract_id);
-- Index source: controllers/contractsController.js:1139
CREATE INDEX IF NOT EXISTS contract_document_versions_document_id_idx ON public.contract_document_versions (document_id);
-- Index source: controllers/contractsController.js:1135
CREATE UNIQUE INDEX IF NOT EXISTS contract_document_versions_one_current_idx ON public.contract_document_versions (document_id) WHERE is_current = TRUE;
-- Index source: controllers/contractsController.js:1140
CREATE INDEX IF NOT EXISTS contract_document_versions_uploaded_at_idx ON public.contract_document_versions (uploaded_at DESC);
-- Index source: controllers/contractsController.js:1136
CREATE INDEX IF NOT EXISTS contract_documents_contract_id_idx ON public.contract_documents (contract_id);
-- Index source: controllers/contractsController.js:1137
CREATE INDEX IF NOT EXISTS contract_documents_document_type_idx ON public.contract_documents (document_type);
-- Index source: sql/manual/021_contract_equipment_coverage.sql
CREATE INDEX IF NOT EXISTS contract_equipment_coverage_contract_idx ON public.contract_equipment_coverage (contract_id,equipment_id);
-- Index source: sql/manual/021_contract_equipment_coverage.sql
CREATE INDEX IF NOT EXISTS contract_equipment_coverage_equipment_dates_idx ON public.contract_equipment_coverage (institute_id,equipment_id,coverage_start,coverage_end);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_invoices_contract_id_idx ON public.contract_invoices (contract_id);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_invoices_invoice_number_idx ON public.contract_invoices (invoice_number);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_invoices_matching_status_idx ON public.contract_invoices (matching_status);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_invoices_status_idx ON public.contract_invoices (status);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_invoices_supplier_id_idx ON public.contract_invoices (supplier_id);
-- Index source: sql/manual/022_contract_item_master_identity.sql
CREATE INDEX IF NOT EXISTS contract_items_catalog_idx ON public.contract_items (supplier_catalog_item_id) WHERE supplier_catalog_item_id IS NOT NULL;
-- Index source: sql/manual/022_contract_item_master_identity.sql
CREATE INDEX IF NOT EXISTS contract_items_generic_idx ON public.contract_items (generic_item_id) WHERE generic_item_id IS NOT NULL;
-- Index source: sql/manual/022_contract_item_master_identity.sql
CREATE INDEX IF NOT EXISTS contract_items_product_idx ON public.contract_items (approved_product_id) WHERE approved_product_id IS NOT NULL;
-- Index source: controllers/contractsController.js:1199
CREATE INDEX IF NOT EXISTS contract_obligations_contract_id_idx ON public.contract_obligations (contract_id);
-- Index source: controllers/contractsController.js:1201
CREATE INDEX IF NOT EXISTS contract_obligations_due_date_idx ON public.contract_obligations (due_date);
-- Index source: controllers/contractsController.js:1203
CREATE INDEX IF NOT EXISTS contract_obligations_next_due_date_idx ON public.contract_obligations (next_due_date);
-- Index source: controllers/contractsController.js:1200
CREATE INDEX IF NOT EXISTS contract_obligations_owner_user_id_idx ON public.contract_obligations (owner_user_id);
-- Index source: controllers/contractsController.js:1202
CREATE INDEX IF NOT EXISTS contract_obligations_status_idx ON public.contract_obligations (status);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_payments_contract_id_idx ON public.contract_payments (contract_id);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_payments_invoice_id_idx ON public.contract_payments (invoice_id);
-- Index source: controllers/contractsController.js:3798
CREATE INDEX IF NOT EXISTS contract_payments_status_idx ON public.contract_payments (status);
-- Index source: controllers/contractsController.js:1205
CREATE INDEX IF NOT EXISTS contract_renewal_events_alert_date_idx ON public.contract_renewal_events (alert_date);
-- Index source: controllers/contractsController.js:1204
CREATE INDEX IF NOT EXISTS contract_renewal_events_contract_id_idx ON public.contract_renewal_events (contract_id);
-- Index source: controllers/contractsController.js:1206
CREATE INDEX IF NOT EXISTS contract_renewal_events_renewal_date_idx ON public.contract_renewal_events (renewal_date);
-- Index source: controllers/contractsController.js:1207
CREATE INDEX IF NOT EXISTS contract_renewal_events_status_idx ON public.contract_renewal_events (status);
-- Index source: controllers/contractsController.js:3742
CREATE INDEX IF NOT EXISTS contract_risk_assessments_assessed_at_idx ON public.contract_risk_assessments (assessed_at DESC);
-- Index source: controllers/contractsController.js:3742
CREATE INDEX IF NOT EXISTS contract_risk_assessments_contract_id_idx ON public.contract_risk_assessments (contract_id);
-- Index source: controllers/contractsController.js:3742
CREATE INDEX IF NOT EXISTS contract_risk_assessments_risk_level_idx ON public.contract_risk_assessments (risk_level);
-- Index source: controllers/contractsController.js:755
CREATE UNIQUE INDEX IF NOT EXISTS contracts_reference_number_idx ON public.contracts (reference_number)
           WHERE reference_number IS NOT NULL;
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS custody_records_asset_idx ON public.custody_records (asset_id,created_at DESC) WHERE asset_id IS NOT NULL;
-- Index source: sql/manual/012_procurement_priority_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS department_priority_one_current_case ON public.department_priority_rankings (procurement_case_id) WHERE valid_until IS NULL;
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_criteria_code_contract_uq ON public.evaluation_criteria (code);
-- Index source: utils/evaluationCriteriaSeeder.js:97
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_criteria_code_unique_idx ON public.evaluation_criteria (code);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS generic_items_filters_idx ON public.generic_items (lifecycle_status, category, item_type);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS generic_items_fingerprint_idx ON public.generic_items (structured_fingerprint);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS generic_items_search_idx ON public.generic_items USING GIN
  (to_tsvector('simple', item_code || ' ' || generic_name || ' ' || canonical_description));
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_idempotency_uq ON public.goods_receipts (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS goods_receipt_items_po_line_idx ON public.goods_receipt_items (purchase_order_item_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_number_uq ON public.goods_receipts (receipt_number) WHERE receipt_number IS NOT NULL;
-- Index source: sql/20260313_procure_to_pay_document_flow.sql
CREATE INDEX IF NOT EXISTS idx_ap_payables_request_id ON public.ap_payables (request_id);
-- Index source: sql/manual/031_p2p_batch1_authority_hardening.sql
CREATE INDEX IF NOT EXISTS idx_ap_payables_supplier_id ON public.ap_payables (supplier_id);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_ap_vouchers_request_id ON public.ap_vouchers (request_id);
-- Index source: sql/manual/003_request_reclassification_and_uom.sql
CREATE INDEX IF NOT EXISTS idx_approvals_is_superseded ON public.approvals (is_superseded);
-- Index source: sql/manual/003_request_reclassification_and_uom.sql
CREATE INDEX IF NOT EXISTS idx_approvals_request_id ON public.approvals (request_id);
-- Index source: sql/manual/003_request_reclassification_and_uom.sql
CREATE INDEX IF NOT EXISTS idx_approvals_route_snapshot_id ON public.approvals (route_snapshot_id);
-- Index source: utils/ensureFinanceCoreTables.js:101
CREATE INDEX IF NOT EXISTS idx_budget_envelopes_dept_proj ON public.budget_envelopes (department_id, project_id, fiscal_year);
-- Index source: utils/ensureFinanceCoreTables.js:103
CREATE INDEX IF NOT EXISTS idx_commitment_ledger_budget ON public.commitment_ledger (budget_envelope_id, stage);
-- Index source: utils/ensureFinanceCoreTables.js:102
CREATE INDEX IF NOT EXISTS idx_commitment_ledger_request ON public.commitment_ledger (request_id, stage);
-- Index source: utils/ensureDepartmentItemFollowUpNotesTable.js:31
CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_created_at ON public.department_item_follow_up_notes (created_at);
-- Index source: utils/ensureDepartmentItemFollowUpNotesTable.js:27
CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_department_id ON public.department_item_follow_up_notes (department_id);
-- Index source: utils/ensureDepartmentItemFollowUpNotesTable.js:23
CREATE INDEX IF NOT EXISTS idx_department_item_follow_up_notes_item_id ON public.department_item_follow_up_notes (requested_item_id);
-- Index source: sql/20260313_procure_to_pay_document_flow.sql
CREATE INDEX IF NOT EXISTS idx_document_flow_links_request_id ON public.document_flow_links (request_id);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_finance_action_history_request_id ON public.finance_action_history (request_id);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_finance_postings_request_id ON public.finance_postings (request_id);
-- Index source: utils/ensureFinanceCoreTables.js:108
CREATE INDEX IF NOT EXISTS idx_gl_posting_lines_posting ON public.gl_posting_lines (gl_posting_id);
-- Index source: utils/ensureFinanceCoreTables.js:107
CREATE INDEX IF NOT EXISTS idx_gl_postings_request ON public.gl_postings (request_id, posted_at);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_goods_receipts_request_id ON public.goods_receipts (request_id);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_invoice_match_results_request_id ON public.invoice_match_results (request_id);
-- Index source: utils/ensureItemMasterTables.js:186
CREATE INDEX IF NOT EXISTS idx_item_conversion_master_id ON public.item_conversion (item_master_id);
-- Index source: utils/ensureItemMasterTables.js:178
CREATE INDEX IF NOT EXISTS idx_item_master_category ON public.item_master (category_id);
-- Index source: utils/ensureItemMasterTables.js:190
CREATE INDEX IF NOT EXISTS idx_item_master_items_search ON public.item_master_items (LOWER(item_name), LOWER(generic_name), LOWER(brand_name), LOWER(item_code));
-- Index source: utils/ensureItemMasterTables.js:182
CREATE INDEX IF NOT EXISTS idx_item_variants_master_id ON public.item_variants (item_master_id);
-- Index source: utils/ensureFinanceCoreTables.js:104
CREATE INDEX IF NOT EXISTS idx_journal_entries_request ON public.journal_entries (request_id, posted_at);
-- Index source: utils/ensureFinanceCoreTables.js:105
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON public.journal_entries (source_type, source_id);
-- Index source: utils/ensureFinanceCoreTables.js:106
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON public.journal_entry_lines (journal_entry_id);
-- Index source: utils/ensureMonthlyDispensingTables.js:22
CREATE INDEX IF NOT EXISTS idx_monthly_dispensing_item ON public.monthly_dispensing (LOWER(item_name));
-- Index source: utils/ensureMonthlyDispensingTables.js:19
CREATE INDEX IF NOT EXISTS idx_monthly_dispensing_month ON public.monthly_dispensing (month_start);
-- Index source: utils/ensureProcureToPayTables.js:276
CREATE INDEX IF NOT EXISTS idx_non_po_receipt_approvals_receipt_id ON public.non_po_receipt_approvals (goods_receipt_id);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_payment_records_request_id ON public.payment_records (request_id);
-- Index source: utils/ensureProcurementPlanTables.js:50
CREATE INDEX IF NOT EXISTS idx_plan_item_consumptions_item ON public.procurement_plan_item_consumptions (plan_item_id);
-- Index source: utils/ensureProcurementPlanTables.js:49
CREATE INDEX IF NOT EXISTS idx_plan_item_requests_item ON public.procurement_plan_item_requests (plan_item_id);
-- Index source: utils/ensureProcurementPlanTables.js:48
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON public.procurement_plan_items (plan_id);
-- Index source: routes/printServiceRequests.js:14
CREATE INDEX IF NOT EXISTS idx_print_service_requests_accepted_by ON public.print_service_requests (accepted_by);
-- Index source: routes/printServiceRequests.js:14
CREATE INDEX IF NOT EXISTS idx_print_service_requests_created_at ON public.print_service_requests (created_at DESC);
-- Index source: routes/printServiceRequests.js:14
CREATE INDEX IF NOT EXISTS idx_print_service_requests_requester ON public.print_service_requests (requester_id);
-- Index source: routes/printServiceRequests.js:14
CREATE INDEX IF NOT EXISTS idx_print_service_requests_status ON public.print_service_requests (status);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_proc_state_history_request_id ON public.procurement_state_history (request_id);
-- Index source: services/procurementEvaluationService.js:427
CREATE INDEX IF NOT EXISTS idx_procurement_evaluation_results_case_rank ON public.procurement_evaluation_results (evaluation_case_id, rank);
-- Index source: sql/migrations/20261003_procurement_event_overage_decisions.sql
CREATE INDEX IF NOT EXISTS idx_procurement_item_events_overage_decided_by ON public.procurement_item_events (overage_decided_by);
-- Index source: sql/migrations/20260608_procurement_item_events.sql
CREATE INDEX IF NOT EXISTS idx_procurement_item_events_procurement_date ON public.procurement_item_events (procurement_date);
-- Index source: sql/migrations/20260608_procurement_item_events.sql
CREATE INDEX IF NOT EXISTS idx_procurement_item_events_procurement_user_id ON public.procurement_item_events (procurement_user_id);
-- Index source: sql/migrations/20260608_procurement_item_events.sql
CREATE INDEX IF NOT EXISTS idx_procurement_item_events_request_id ON public.procurement_item_events (request_id);
-- Index source: sql/migrations/20260608_procurement_item_events.sql
CREATE INDEX IF NOT EXISTS idx_procurement_item_events_requested_item_id ON public.procurement_item_events (requested_item_id);
-- Index source: utils/ensureProjectsTable.js:46
CREATE INDEX IF NOT EXISTS idx_project_department_visibility_department ON public.project_department_visibility (department_id);
-- Index source: utils/ensureProjectsTable.js:33
CREATE INDEX IF NOT EXISTS idx_projects_lower_name ON public.projects (LOWER(name));
-- Index source: sql/20260313_procure_to_pay_document_flow.sql
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON public.purchase_order_items (purchase_order_id);
-- Index source: sql/20260313_procure_to_pay_document_flow.sql
CREATE INDEX IF NOT EXISTS idx_purchase_orders_request_id ON public.purchase_orders (request_id);
-- Index source: utils/ensureRequestEditApprovalsTable.js:22
CREATE INDEX IF NOT EXISTS idx_request_edit_approvals_approval_id ON public.request_edit_approvals (approval_id);
-- Index source: utils/ensureRequestEditApprovalsTable.js:17
CREATE INDEX IF NOT EXISTS idx_request_edit_approvals_pending ON public.request_edit_approvals (request_id, status);
-- Index source: controllers/requests/assignRequestController.js:17
CREATE INDEX IF NOT EXISTS idx_requested_items_assigned_to ON public.requested_items (assigned_to);
-- Index source: controllers/requests/assignRequestController.js:21
CREATE INDEX IF NOT EXISTS idx_requested_items_request_assignee ON public.requested_items (request_id, assigned_to);
-- Index source: utils/ensureMaintenanceRequestSchema.js:35
CREATE INDEX IF NOT EXISTS idx_requests_initiated_by_technician_id ON public.requests (initiated_by_technician_id);
-- Index source: utils/ensureMaintenanceRequestSchema.js:39
CREATE INDEX IF NOT EXISTS idx_requests_maintenance_ref_number ON public.requests (maintenance_ref_number);
-- Index source: utils/ensureProjectsTable.js:62
CREATE INDEX IF NOT EXISTS idx_requests_project_id ON public.requests (project_id);
-- Index source: sql/warehouses.sql
CREATE INDEX IF NOT EXISTS idx_requests_supply_warehouse ON public.requests (supply_warehouse_id);
-- Index source: utils/ensureHistoricalRequestSchema.js:59
CREATE INDEX IF NOT EXISTS idx_requests_temporary_requester_name ON public.requests (temporary_requester_name);
-- Index source: sql/migrations/20260312_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_request_id ON public.supplier_invoices (request_id);
-- Index source: sql/warehouses.sql
CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON public.users (warehouse_id);
-- Index source: sql/warehouses.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_lower_name ON public.warehouses (LOWER(name));
-- Index source: utils/ensureWarehouseSupplyTables.js:28
CREATE INDEX IF NOT EXISTS idx_wsi_request_id ON public.warehouse_supply_items (request_id);
-- Index source: utils/ensureWarehouseSupplyTables.js:36
CREATE INDEX IF NOT EXISTS idx_wsi_requested_item_id ON public.warehouse_supply_items (requested_item_id);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS idx_wsl_warehouse_item ON public.warehouse_stock_levels (warehouse_id, stock_item_id);
-- Index source: utils/ensureWarehouseSupplyTables.js:29
CREATE INDEX IF NOT EXISTS idx_wsup_request_id ON public.warehouse_supplied_items (request_id);
-- Index source: utils/ensureWarehouseTransferTables.js:37
CREATE INDEX IF NOT EXISTS idx_wti_transfer ON public.warehouse_transfer_items (transfer_id);
-- Index source: utils/ensureWarehouseTransferTables.js:35
CREATE INDEX IF NOT EXISTS idx_wtr_destination ON public.warehouse_transfer_requests (destination_warehouse_id);
-- Index source: utils/ensureWarehouseTransferTables.js:34
CREATE INDEX IF NOT EXISTS idx_wtr_origin ON public.warehouse_transfer_requests (origin_warehouse_id);
-- Index source: utils/ensureWarehouseTransferTables.js:36
CREATE INDEX IF NOT EXISTS idx_wtr_status ON public.warehouse_transfer_requests (status);
-- Index source: sql/manual/005_inventory_operations.sql
CREATE INDEX IF NOT EXISTS inventory_reservation_allocations_reservation_idx ON public.inventory_reservation_allocations (reservation_id,id);
-- Index source: sql/manual/005_inventory_operations.sql
CREATE INDEX IF NOT EXISTS inventory_reservation_issue_operations_reservation_idx ON public.inventory_reservation_issue_operations (reservation_id,created_at);
-- Index source: sql/manual/005_inventory_operations.sql
CREATE INDEX IF NOT EXISTS inventory_reservations_available_idx ON public.inventory_reservations (warehouse_id,stock_item_id,status) WHERE status='ACTIVE';
-- Index source: sql/manual/005_inventory_operations.sql
CREATE INDEX IF NOT EXISTS inventory_transfer_allocation_links_line_idx ON public.inventory_transfer_allocation_links (transfer_line_id,dispatch_allocation_id);
-- Index source: sql/manual/005_inventory_operations.sql
CREATE INDEX IF NOT EXISTS inventory_transfer_links_transfer_idx ON public.inventory_transfer_movement_links (transfer_id,transfer_line_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS invoice_match_history_idx ON public.invoice_match_results (supplier_invoice_id,matched_at DESC);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS invoice_match_override_history_idx ON public.invoice_match_override_decisions (invoice_match_result_id,decided_at DESC,id DESC);
-- Index source: sql/manual/008_phase5a1_reference_master_baseline.sql
CREATE UNIQUE INDEX IF NOT EXISTS item_categories_normalized_name_idx ON public.item_categories (normalized_name);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS item_duplicate_review_queue_idx ON public.item_duplicate_reviews (entity_type, decision);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS item_manufacturers_normalized_name_idx ON public.item_manufacturers (normalized_name);
-- Index source: utils/ensureItemRecallsTable.js:49
CREATE INDEX IF NOT EXISTS item_recalls_item_idx ON public.item_recalls (item_id);
-- Index source: utils/ensureItemRecallsTable.js:50
CREATE INDEX IF NOT EXISTS item_recalls_item_name_idx ON public.item_recalls (LOWER(item_name));
-- Index source: utils/ensureItemRecallsTable.js:48
CREATE INDEX IF NOT EXISTS item_recalls_status_idx ON public.item_recalls (LOWER(status));
-- Index source: sql/manual/008_phase5a1_reference_master_baseline.sql
CREATE UNIQUE INDEX IF NOT EXISTS item_uom_normalized_uom_code_idx ON public.item_uom (normalized_uom_code);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS ix_inventory_allocations_balance ON public.inventory_transaction_allocations (warehouse_stock_level_id);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS ix_inventory_allocations_movement ON public.inventory_transaction_allocations (inventory_transaction_id, allocation_sequence);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS ix_inventory_allocations_trace ON public.inventory_transaction_allocations (stock_item_id, batch_number, lot_number, serial_number, expiry_date);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS ix_inventory_balance_lock ON public.warehouse_stock_levels (warehouse_id, stock_item_id, stock_status, batch_number, lot_number, serial_number, id);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE INDEX IF NOT EXISTS ix_inventory_ledger_scope ON public.inventory_transactions (institute_id, warehouse_id, stock_item_id, posted_at DESC);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS legacy_item_active_mapping_idx ON public.legacy_item_mappings (source_table, legacy_item_id) WHERE mapping_status='active';
-- Index source: sql/manual/019_asset_equipment_integration.sql
CREATE UNIQUE INDEX IF NOT EXISTS maintainable_equipment_asset_uq ON public.maintainable_equipment (asset_id) WHERE asset_id IS NOT NULL;
-- Index source: sql/manual/019_asset_equipment_integration.sql
CREATE INDEX IF NOT EXISTS maintainable_equipment_institute_asset_idx ON public.maintainable_equipment (institute_id,asset_id) WHERE asset_id IS NOT NULL;
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS maintainable_equipment_institute_code_uq ON public.maintainable_equipment (institute_id, lower(btrim(equipment_code)));
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS maintainable_equipment_institute_department_lifecycle_idx ON public.maintainable_equipment (institute_id, department_id, lifecycle_status);
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS maintainable_equipment_institute_name_idx ON public.maintainable_equipment (institute_id, name);
-- Index source: sql/manual/025_maintenance_inventory_execution.sql
CREATE INDEX IF NOT EXISTS maintenance_part_inventory_operations_part_idx ON public.maintenance_part_inventory_operations (work_order_part_id,created_at);
-- Index source: sql/manual/025_maintenance_inventory_execution.sql
CREATE INDEX IF NOT EXISTS maintenance_work_order_parts_movement_idx ON public.maintenance_work_order_parts (issued_inventory_movement_id) WHERE issued_inventory_movement_id IS NOT NULL;
-- Index source: sql/manual/025_maintenance_inventory_execution.sql
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_work_order_parts_reservation_uq ON public.maintenance_work_order_parts (reservation_id) WHERE reservation_id IS NOT NULL;
-- Index source: sql/manual/024_maintenance_work_orders.sql
CREATE INDEX IF NOT EXISTS maintenance_work_order_parts_work_order_idx ON public.maintenance_work_order_parts (work_order_id,action);
-- Index source: sql/manual/024_maintenance_work_orders.sql
CREATE INDEX IF NOT EXISTS maintenance_work_orders_equipment_idx ON public.maintenance_work_orders (institute_id,equipment_id,requested_at DESC);
-- Index source: sql/manual/024_maintenance_work_orders.sql
CREATE INDEX IF NOT EXISTS maintenance_work_orders_status_idx ON public.maintenance_work_orders (institute_id,status,priority,requested_at DESC);
-- Index source: backend-query-derived-contract
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON public.notification_outbox (next_attempt_at,id) WHERE status IN ('pending','failed');
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS notifications_outbox_event_uq ON public.notifications (outbox_event_id);
-- Index source: utils/notificationService.js:22
CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx ON public.notifications (user_id, is_read, created_at DESC);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS one_active_payable_per_invoice_uq ON public.ap_payables (supplier_invoice_id) WHERE payable_status IN ('OPEN','PARTIALLY_PAID');
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS one_active_po_commitment_idx ON public.commitment_ledger (purchase_order_id) WHERE stage='encumbrance' AND state='ACTIVE';
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS one_actualization_per_voucher_uq ON public.commitment_ledger (ap_voucher_id) WHERE stage='actual' AND ap_voucher_id IS NOT NULL;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS one_payable_per_voucher_uq ON public.ap_payables (ap_voucher_id) WHERE ap_voucher_id IS NOT NULL;
-- Index source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
CREATE UNIQUE INDEX IF NOT EXISTS organization_head_reconciliation_current_uq ON public.organization_head_reconciliation_decisions (organization_unit_id) WHERE superseded_at IS NULL;
-- Index source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
CREATE INDEX IF NOT EXISTS organization_head_reconciliation_decisions_scope_idx ON public.organization_head_reconciliation_decisions (institute_id,organization_unit_id,decided_at DESC);
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE UNIQUE INDEX IF NOT EXISTS organization_positions_unique_authority_uq ON public.organization_positions (organization_unit_id, position_type)
  WHERE is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD');
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE UNIQUE INDEX IF NOT EXISTS organization_positions_unit_head_uq ON public.organization_positions (organization_unit_id) WHERE is_active AND is_unit_head;
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE INDEX IF NOT EXISTS organization_positions_unit_idx ON public.organization_positions (organization_unit_id, is_active);
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE INDEX IF NOT EXISTS organization_positions_user_idx ON public.organization_positions (user_id);
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE UNIQUE INDEX IF NOT EXISTS organization_units_institute_code_uq ON public.organization_units (institute_id, lower(code)) WHERE code IS NOT NULL;
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE INDEX IF NOT EXISTS organization_units_institute_idx ON public.organization_units (institute_id, is_active);
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE INDEX IF NOT EXISTS organization_units_parent_idx ON public.organization_units (parent_unit_id);
-- Index source: sql/manual/014_organization_hierarchy.sql
CREATE INDEX IF NOT EXISTS organization_units_type_active_idx ON public.organization_units (unit_type, is_active);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS payment_allocation_payable_idx ON public.payment_allocations (ap_payable_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_uq ON public.payment_records (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS pending_item_queue_idx ON public.pending_item_requests (status, created_at);
-- Index source: sql/manual/009_phase5a2_uom_authority.sql
CREATE UNIQUE INDEX IF NOT EXISTS pending_item_requests_one_active_per_item ON public.pending_item_requests (requested_item_id) WHERE requested_item_id IS NOT NULL AND status IN ('submitted','review','needs_information');
-- Index source: controllers/demandPlanningController.js:256
CREATE UNIQUE INDEX IF NOT EXISTS planning_settings_warehouse_key ON public.planning_settings ((COALESCE(warehouse_id, -1)));
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS po_items_award_idx ON public.purchase_order_items (award_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS po_items_award_quantity_idx ON public.purchase_order_items (award_id, purchase_order_id)
  INCLUDE (quantity);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS po_items_request_item_idx ON public.purchase_order_items (request_item_id);
-- Index source: sql/manual/012_procurement_priority_foundation.sql
CREATE INDEX IF NOT EXISTS priority_history_case_time ON public.procurement_priority_history (procurement_case_id, calculated_at DESC);
-- Index source: sql/manual/012_procurement_priority_foundation.sql
CREATE INDEX IF NOT EXISTS priority_profiles_public_queue ON public.procurement_priority_profiles (institute_id, institutional_rank) WHERE is_public;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS procurement_awards_request_item_idx ON public.procurement_awards (request_item_id) WHERE status='ACTIVE';
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS procurement_case_activities_idempotency_uq ON public.procurement_case_activities (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE INDEX IF NOT EXISTS procurement_case_activities_supplier_idx ON public.procurement_case_activities (supplier_id, activity_type) WHERE supplier_id IS NOT NULL;
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE INDEX IF NOT EXISTS procurement_case_activities_timeline_idx ON public.procurement_case_activities (procurement_case_id, activity_at DESC);
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS procurement_cases_one_active_item_uq ON public.procurement_cases (requested_item_id) WHERE closed_at IS NULL;
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE INDEX IF NOT EXISTS procurement_cases_pipeline_idx ON public.procurement_cases (case_status, pending_root_cause) WHERE closed_at IS NULL;
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE INDEX IF NOT EXISTS procurement_cases_scope_idx ON public.procurement_cases (institute_id, department_id, assigned_buyer_id, opened_at);
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS procurement_plan_consumption_contract_uq ON public.procurement_plan_item_consumptions (plan_item_id,warehouse_stock_movement_id,department_stock_movement_id) NULLS NOT DISTINCT;
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS procurement_plan_request_contract_uq ON public.procurement_plan_item_requests (plan_item_id,requested_item_id);
-- Index source: sql/manual/010_supply_chain_performance_foundation.sql
CREATE INDEX IF NOT EXISTS procurement_value_events_case_currency_idx ON public.procurement_value_events (procurement_case_id, value_type, currency);
-- Index source: controllers/rfxPortalController.js:126
CREATE INDEX IF NOT EXISTS purchase_orders_request_id_idx ON public.purchase_orders (request_id);
-- Index source: controllers/rfxPortalController.js:129
CREATE INDEX IF NOT EXISTS purchase_orders_rfx_id_idx ON public.purchase_orders (rfx_id);
-- Index source: utils/ensureRequestAutoAssignmentRulesTable.js:24
CREATE UNIQUE INDEX IF NOT EXISTS request_auto_assignment_rules_unique_scope ON public.request_auto_assignment_rules (LOWER(request_type), COALESCE(warehouse_id, 0));
-- Index source: utils/ensureRequestedItemFinancialsTable.js:54
CREATE INDEX IF NOT EXISTS requested_item_financials_contract_idx ON public.requested_item_financials (contract_id);
-- Index source: utils/ensureRequestedItemFinancialsTable.js:57
CREATE INDEX IF NOT EXISTS requested_item_financials_contract_item_idx ON public.requested_item_financials (contract_item_id);
-- Index source: utils/ensureRequestedItemFinancialsTable.js:42
CREATE INDEX IF NOT EXISTS requested_item_financials_item_idx ON public.requested_item_financials (requested_item_id);
-- Index source: utils/ensureRequestedItemFinancialsTable.js:45
CREATE UNIQUE INDEX IF NOT EXISTS requested_item_financials_item_uniq ON public.requested_item_financials (requested_item_id);
-- Index source: utils/ensureRequestedItemFinancialsTable.js:48
CREATE INDEX IF NOT EXISTS requested_item_financials_request_idx ON public.requested_item_financials (request_id);
-- Index source: utils/ensureRequestClientSubmissionKey.js:14
CREATE UNIQUE INDEX IF NOT EXISTS requests_requester_client_submission_key_unique_idx ON public.requests (requester_id, client_submission_key)
         WHERE client_submission_key IS NOT NULL;
-- Index source: utils/ensureRequestSchedulingColumns.js:11
CREATE INDEX IF NOT EXISTS requests_scheduled_for_idx ON public.requests (scheduled_for) WHERE status = 'Scheduled';
-- Index source: sql/manual/026_rfid_portal_enable_scope_index.sql
CREATE INDEX IF NOT EXISTS rfid_portal_enable_scope ON public.rfid_portals (institute_id,enabled)
    WHERE enabled;
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS rfid_read_asset_time_idx ON public.rfid_read_events (asset_id,read_timestamp DESC) WHERE asset_id IS NOT NULL;
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS rfid_read_epc_time_idx ON public.rfid_read_events (epc,read_timestamp DESC);
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE UNIQUE INDEX IF NOT EXISTS rfid_read_external_event_uq ON public.rfid_read_events (integration_client_id,external_event_id) WHERE external_event_id IS NOT NULL;
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS rfid_read_portal_time_idx ON public.rfid_read_events (portal_id,read_timestamp DESC) WHERE portal_id IS NOT NULL;
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS rfid_read_processing_idx ON public.rfid_read_events (processing_status,read_timestamp);
-- Index source: sql/manual/017_fixed_assets_rfid_core.sql
CREATE INDEX IF NOT EXISTS rfid_read_reader_time_idx ON public.rfid_read_events (reader_id,read_timestamp DESC);
-- Index source: controllers/rfxPortalController.js:78
CREATE INDEX IF NOT EXISTS rfx_events_request_id_idx ON public.rfx_events (request_id);
-- Index source: sql/manual/009_phase5a2_uom_authority.sql
CREATE INDEX IF NOT EXISTS rfx_response_items_catalog_idx ON public.rfx_response_items (supplier_catalog_item_id);
-- Index source: sql/manual/009_phase5a2_uom_authority.sql
CREATE INDEX IF NOT EXISTS rfx_response_items_product_idx ON public.rfx_response_items (approved_product_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS rfx_response_items_requested_item_idx ON public.rfx_response_items (requested_item_id);
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE INDEX IF NOT EXISTS rfx_response_items_response_idx ON public.rfx_response_items (rfx_response_id);
-- Index source: controllers/rfxPortalController.js:82
CREATE INDEX IF NOT EXISTS rfx_responses_request_id_idx ON public.rfx_responses (request_id);
-- Index source: controllers/rfxPortalController.js:59
CREATE INDEX IF NOT EXISTS rfx_responses_rfx_id_idx ON public.rfx_responses (rfx_id);
-- Index source: utils/ensureRiskRegisterTable.js:40
CREATE INDEX IF NOT EXISTS risk_register_due_date_idx ON public.risk_register (due_date);
-- Index source: utils/ensureRiskRegisterTable.js:35
CREATE INDEX IF NOT EXISTS risk_register_status_idx ON public.risk_register (status);
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE UNIQUE INDEX IF NOT EXISTS spare_part_equipment_active_uq ON public.spare_part_equipment_compatibility (spare_part_id,equipment_id) WHERE compatibility_status IN ('PENDING','APPROVED');
-- Index source: sql/manual/013_approved_spare_parts_foundation.sql
CREATE INDEX IF NOT EXISTS spare_part_equipment_equipment_active_idx ON public.spare_part_equipment_compatibility (equipment_id, spare_part_id) WHERE compatibility_status <> 'INACTIVE';
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE UNIQUE INDEX IF NOT EXISTS stock_item_one_active_final_mapping_idx ON public.stock_item_master_mappings (stock_item_id) WHERE active AND mapping_status='approved';
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE INDEX IF NOT EXISTS stock_items_generic_identity_idx ON public.stock_items (generic_item_id) WHERE generic_item_id IS NOT NULL;
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE INDEX IF NOT EXISTS stock_items_product_identity_idx ON public.stock_items (approved_product_id) WHERE approved_product_id IS NOT NULL;
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE INDEX IF NOT EXISTS stock_mapping_review_queue_idx ON public.stock_item_master_mappings (mapping_status,confidence_score DESC);
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE INDEX IF NOT EXISTS stock_mapping_stock_idx ON public.stock_item_master_mappings (stock_item_id,created_at DESC);
-- Index source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
CREATE INDEX IF NOT EXISTS stock_staging_source_idx ON public.stock_item_migration_staging (source_stock_item_id,imported_at DESC);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS supplier_catalog_commercial_idx ON public.supplier_catalog_items (supplier_id, currency, unit_price);
-- Index source: sql/manual/009_phase5a2_uom_authority.sql
CREATE INDEX IF NOT EXISTS supplier_catalog_items_purchasing_uom_id_idx ON public.supplier_catalog_items (purchasing_uom_id);
-- Index source: sql/migrations/20260727_item_master_foundation.sql
CREATE INDEX IF NOT EXISTS supplier_catalog_product_idx ON public.supplier_catalog_items (approved_product_id, is_active);
-- Index source: controllers/suppliersController.js:89
CREATE INDEX IF NOT EXISTS supplier_contacts_name_ci_idx ON public.supplier_contacts (supplier_id, LOWER(name));
-- Index source: controllers/suppliersController.js:88
CREATE INDEX IF NOT EXISTS supplier_contacts_supplier_id_idx ON public.supplier_contacts (supplier_id);
-- Index source: controllers/supplierEvaluationsController.js:139
CREATE INDEX IF NOT EXISTS supplier_evaluations_supplier_id_idx ON public.supplier_evaluations (supplier_id);
-- Index source: controllers/supplierEvaluationsController.js:134
CREATE INDEX IF NOT EXISTS supplier_evaluations_supplier_name_idx ON public.supplier_evaluations (LOWER(supplier_name));
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_idempotency_uq ON public.supplier_invoices (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/006_connected_procure_to_pay.sql
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_identity_uq ON public.supplier_invoices (supplier_id, normalized_invoice_number) WHERE supplier_id IS NOT NULL;
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS supplier_principals_authorization_expiry_date_idx ON public.supplier_principals (authorization_expiry_date);
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS supplier_principals_authorization_status_idx ON public.supplier_principals (authorization_status);
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS supplier_principals_principal_name_idx ON public.supplier_principals (principal_name);
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS supplier_principals_supplier_id_idx ON public.supplier_principals (supplier_id);
-- Index source: controllers/suppliersController.js:333
CREATE INDEX IF NOT EXISTS suppliers_name_ci_lookup_idx ON public.suppliers (LOWER(name));
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS suppliers_regulatory_risk_level_idx ON public.suppliers (regulatory_risk_level);
-- Index source: sql/migrations/20260608_supplier_classification_principals.sql
CREATE INDEX IF NOT EXISTS suppliers_supplier_type_idx ON public.suppliers (supplier_type);
-- Index source: utils/ensureTechnicalInspectionsTable.js:41
CREATE INDEX IF NOT EXISTS technical_inspections_item_name_idx ON public.technical_inspections (LOWER(item_name));
-- Index source: utils/ensureTechnicalInspectionsTable.js:71
CREATE INDEX IF NOT EXISTS technical_inspections_request_idx ON public.technical_inspections (request_id);
-- Index source: utils/ensureTechnicalInspectionsTable.js:74
CREATE INDEX IF NOT EXISTS technical_inspections_requested_item_idx ON public.technical_inspections (requested_item_id);
-- Index source: utils/ensureTechnicalInspectionsTable.js:46
CREATE INDEX IF NOT EXISTS technical_inspections_supplier_idx ON public.technical_inspections (LOWER(supplier_name));
-- Index source: utils/ensureMonthlyDispensingTables.js:25
CREATE UNIQUE INDEX IF NOT EXISTS uniq_monthly_dispensing_month_item_facility ON public.monthly_dispensing (month_start, item_name, COALESCE(facility_name, ''));
-- Index source: sql/manual/003_request_reclassification_and_uom.sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_route_step ON public.approvals (request_id, approval_route_version, approval_level, approver_id);
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_available_serial_location ON public.warehouse_stock_levels (stock_item_id, serial_number)
 WHERE serial_number IS NOT NULL AND stock_status = 'AVAILABLE' AND quantity > 0;
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_balance_identity ON public.warehouse_stock_levels (warehouse_id,stock_item_id,stock_status,batch_number,lot_number,serial_number,expiry_date) NULLS NOT DISTINCT;
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_transactions_idempotency ON public.inventory_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Index source: sql/manual/004_inventory_transaction_engine.sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_transactions_reversal ON public.inventory_transactions (reversal_of_movement_id) WHERE reversal_of_movement_id IS NOT NULL;
-- Index source: backend-query-derived-contract
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_replenishment_contract_uq ON public.warehouse_replenishment_policies (warehouse_id,stock_item_id);
-- Retire only the exact obsolete inventory identity keys after canonical uniqueness exists.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT idx.relname AS index_name, con.conname AS constraint_name
      FROM pg_index i
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      JOIN pg_class idx ON idx.oid = i.indexrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype IN ('u', 'p')
     WHERE ns.nspname = 'public' AND tbl.relname = 'warehouse_stock_levels'
       AND i.indisunique AND i.indnkeyatts IN (2, 6) AND i.indexprs IS NULL AND i.indpred IS NULL
       AND (SELECT array_agg(att.attname ORDER BY key.ordinality)
              FROM unnest(i.indkey::smallint[]) WITH ORDINALITY key(attnum, ordinality)
              JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum
             WHERE key.ordinality <= i.indnkeyatts)
           IN (ARRAY['warehouse_id','stock_item_id']::name[],
               ARRAY['warehouse_id','stock_item_id','batch_id','lot_number','expiry_date','serial_number']::name[])
  LOOP
    IF candidate.constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.warehouse_stock_levels DROP CONSTRAINT %I', candidate.constraint_name);
    ELSE
      EXECUTE format('DROP INDEX public.%I', candidate.index_name);
    END IF;
  END LOOP;
END $$;

-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_delegation_no_overlap_excl') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_delegation_no_overlap_excl EXCLUDE USING gist
  (institute_id WITH =,authority_kind WITH =,authority_id WITH =,scope WITH =,effective_period WITH &&) WHERE (status='ACTIVE');
  END IF;
END $constraint$;
-- Constraint source: sql/manual/015_approval_policy_engine_foundation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_rules'::regclass AND conname='approval_policy_rules_priority_positive_check') THEN
    ALTER TABLE public.approval_policy_rules ADD CONSTRAINT approval_policy_rules_priority_positive_check CHECK(priority>0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_steps'::regclass AND conname='approval_policy_shadow_steps_resolution_status_check') THEN
    ALTER TABLE public.approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_resolution_status_check CHECK(resolution_status IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED','DUPLICATE_PRINCIPAL')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_snapshot_generation_ck') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_snapshot_generation_ck CHECK(generation_number>=1) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_snapshot_generation_uq') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_snapshot_generation_uq UNIQUE(request_id,generation_number);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_snapshot_row_version_ck') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_snapshot_row_version_ck CHECK(row_version=1) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_snapshot_supersedes_uq') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_snapshot_supersedes_uq UNIQUE(supersedes_snapshot_id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/024_maintenance_work_orders.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_institute_id_id_uq') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_institute_id_id_uq UNIQUE(institute_id,id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/029_fixed_asset_deployment_valuation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_movement_type_check') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_movement_type_check CHECK(movement_type IN (
    'INITIAL_DEPLOYMENT','PERMANENT_TRANSFER','TEMPORARY_LOAN','MAINTENANCE_TRANSFER',
    'EXTERNAL_MAINTENANCE','RETURN','STORAGE_TRANSFER','DISPOSAL_TRANSFER','LOCATION_CORRECTION')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/028_asset_movement_operational_hardening.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_return_origin_ck') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_return_origin_ck CHECK (
    (movement_type='RETURN' AND origin_movement_id IS NOT NULL)
    OR (movement_type<>'RETURN' AND origin_movement_id IS NULL)
  ) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/029_fixed_asset_deployment_valuation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_acquisition_amount_iqd_nonnegative_ck') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_acquisition_amount_iqd_nonnegative_ck CHECK(acquisition_amount_iqd IS NULL OR acquisition_amount_iqd>=0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/029_fixed_asset_deployment_valuation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_acquisition_currency_format_ck') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_acquisition_currency_format_ck CHECK(acquisition_currency IS NULL OR acquisition_currency ~ '^[A-Z]{3}$') NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/029_fixed_asset_deployment_valuation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_exchange_rate_positive_ck') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_exchange_rate_positive_ck CHECK(exchange_rate_to_iqd IS NULL OR exchange_rate_to_iqd>0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/019_asset_equipment_integration.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_institute_id_id_uq') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_institute_id_id_uq UNIQUE (institute_id,id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/024_maintenance_work_orders.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_institute_id_id_equipment_uq') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_institute_id_id_equipment_uq UNIQUE(institute_id,id,equipment_id);
  END IF;
END $constraint$;
-- Constraint source: sql/20260907_expand_custody_form.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.custody_records'::regclass AND conname='custody_records_condition_at_issue_check') THEN
    ALTER TABLE public.custody_records ADD CONSTRAINT custody_records_condition_at_issue_check CHECK (condition_at_issue IS NULL OR condition_at_issue IN
      ('New', 'Excellent', 'Good', 'Fair', 'Damaged / Defective')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/20260907_expand_custody_form.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.custody_records'::regclass AND conname='custody_records_custody_type_check') THEN
    ALTER TABLE public.custody_records ADD CONSTRAINT custody_records_custody_type_check CHECK (custody_type IN ('Personal', 'Departmental', 'Location')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/031_p2p_batch1_authority_hardening.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.document_flow_links'::regclass AND conname='document_flow_links_unique_edge') THEN
    ALTER TABLE public.document_flow_links ADD CONSTRAINT document_flow_links_unique_edge UNIQUE (request_id, source_document_type, source_document_id,
              target_document_type, target_document_id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/009_phase5a2_uom_authority.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_positive_conversion') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_positive_conversion CHECK (conversion_factor IS NULL OR conversion_factor > 0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/005_inventory_operations.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_consumed_check') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_consumed_check CHECK(consumed_quantity>=0 AND consumed_quantity<=quantity) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/005_inventory_operations.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_idempotency_key_nonempty') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_idempotency_key_nonempty CHECK(btrim(idempotency_key)<>'') NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_positive_conversion') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_positive_conversion CHECK (conversion_factor IS NULL OR conversion_factor > 0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_transaction_type_check') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check CHECK (transaction_type IN
 ('warehouse','department','transfer','receipt','issue','adjustment','recall','GOODS_RECEIPT','GOODS_RECEIPT_REVERSAL','ISSUE','ISSUE_REVERSAL','TRANSFER_DISPATCH','TRANSFER_RECEIPT','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','QUARANTINE','RELEASE_FROM_QUARANTINE')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/005_inventory_operations.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_receipt_operations'::regclass AND conname='inventory_transfer_receipt_operations_idempotency_key_nonempty') THEN
    ALTER TABLE public.inventory_transfer_receipt_operations ADD CONSTRAINT inventory_transfer_receipt_operations_idempotency_key_nonempty CHECK(btrim(idempotency_key)<>'') NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/021_contract_equipment_coverage.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintainable_equipment'::regclass AND conname='maintainable_equipment_institute_id_id_uq') THEN
    ALTER TABLE public.maintainable_equipment ADD CONSTRAINT maintainable_equipment_institute_id_id_uq UNIQUE (institute_id,id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/025_maintenance_inventory_execution.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_institute_id_id_uq') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_institute_id_id_uq UNIQUE(institute_id,id);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_unique_authority_period') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_unique_authority_period EXCLUDE USING gist (organization_unit_id WITH =,position_type WITH =,daterange(COALESCE(effective_from,'-infinity'::date),COALESCE(effective_to+1,'infinity'::date),'[)') WITH &&) WHERE (is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD'));
  END IF;
END $constraint$;
-- Constraint source: sql/manual/016_organization_hierarchy_cutover_readiness.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_unit_head_period') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_unit_head_period EXCLUDE USING gist (organization_unit_id WITH =,daterange(COALESCE(effective_from,'-infinity'::date),COALESCE(effective_to+1,'infinity'::date),'[)') WITH &&) WHERE (is_active AND is_unit_head);
  END IF;
END $constraint$;
-- Constraint source: sql/manual/009_phase5a2_uom_authority.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_positive_conversion') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_positive_conversion CHECK (conversion_factor IS NULL OR conversion_factor > 0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20260727_item_master_foundation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_catalog_status_check') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_catalog_status_check CHECK
    (catalog_status IN ('catalogued','pending_mapping','approved_exception')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20260727_item_master_foundation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_request_mode_check') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_request_mode_check CHECK
    (request_mode IN ('generic_item','generic_item_with_preference','specific_approved_product','service','pending_item_creation','approved_free_text_exception')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20260727_item_master_foundation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_stocking_policy_check') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_stocking_policy_check CHECK
    (stocking_policy IN ('stock','non_stock','consignment','direct_delivery','service')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/phase1b/01_stock_item_identity_columns.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_identity_source_check') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_identity_source_check CHECK (identity_source IN ('normalized','legacy_stock_item','approved_exception')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/phase1b/01_stock_item_identity_columns.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_mapping_status_check') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_mapping_status_check CHECK (mapping_status IN ('unmapped','auto_matched','review_required','mapped_generic','mapped_product','duplicate','obsolete','excluded')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/phase1b/01_stock_item_identity_columns.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_product_requires_generic') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_product_requires_generic CHECK (approved_product_id IS NULL OR generic_item_id IS NOT NULL) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_communication_effectiveness_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_communication_effectiveness_scale CHECK (communication_effectiveness IS NULL OR (communication_effectiveness >= 1 AND communication_effectiveness <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_compliance_alignment_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_compliance_alignment_scale CHECK (compliance_alignment IS NULL OR (compliance_alignment >= 1 AND compliance_alignment <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_delivery_as_scheduled_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_delivery_as_scheduled_scale CHECK (delivery_as_scheduled IS NULL OR (delivery_as_scheduled >= 1 AND delivery_as_scheduled <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_delivery_in_good_condition_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_delivery_in_good_condition_scale CHECK (delivery_in_good_condition IS NULL OR (delivery_in_good_condition >= 1 AND delivery_in_good_condition <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_delivery_quality_expectations_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_delivery_quality_expectations_scale CHECK (delivery_meets_quality_expectations IS NULL OR (delivery_meets_quality_expectations >= 1 AND delivery_meets_quality_expectations <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_operations_effectiveness_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_operations_effectiveness_scale CHECK (operations_effectiveness_rating IS NULL OR (operations_effectiveness_rating >= 1 AND operations_effectiveness_rating <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_overall_supplier_happiness_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_overall_supplier_happiness_scale CHECK (overall_supplier_happiness IS NULL OR (overall_supplier_happiness >= 1 AND overall_supplier_happiness <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_payment_terms_comfort_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_payment_terms_comfort_scale CHECK (payment_terms_comfort IS NULL OR (payment_terms_comfort >= 1 AND payment_terms_comfort <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/supplierEvaluationsController.js:167
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='chk_supplier_eval_price_satisfaction_scale') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT chk_supplier_eval_price_satisfaction_scale CHECK (price_satisfaction IS NULL OR (price_satisfaction >= 1 AND price_satisfaction <= 5)) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20260608_supplier_classification_principals.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND conname='suppliers_regulatory_risk_level_allowed_chk') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_regulatory_risk_level_allowed_chk CHECK (regulatory_risk_level IN ('low', 'medium', 'high', 'critical')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20260608_supplier_classification_principals.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND conname='suppliers_supplier_type_allowed_chk') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_supplier_type_allowed_chk CHECK (supplier_type IN (
        'Manufacturer',
        'Authorized Agent',
        'Authorized Distributor',
        'Sub-distributor',
        'Local Trader',
        'Service Provider',
        'Contractor'
      )) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_stock_levels'::regclass AND conname='warehouse_stock_levels_quantity_nonnegative') THEN
    ALTER TABLE public.warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_stock_levels'::regclass AND conname='warehouse_stock_levels_reserved_nonnegative') THEN
    ALTER TABLE public.warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_reserved_nonnegative CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_stock_levels'::regclass AND conname='warehouse_stock_levels_stock_status_check') THEN
    ALTER TABLE public.warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_stock_status_check CHECK (stock_status IN ('AVAILABLE','QUARANTINE','BLOCKED','RECALLED','DAMAGED','EXPIRED')) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/031_p2p_batch1_authority_hardening.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_payables'::regclass AND conname='ap_payables_supplier_id_fkey') THEN
    ALTER TABLE public.ap_payables ADD CONSTRAINT ap_payables_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/003_request_reclassification_and_uom.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approvals'::regclass AND conname='approvals_superseded_by_user_id_fkey') THEN
    ALTER TABLE public.approvals ADD CONSTRAINT approvals_superseded_by_user_id_fkey FOREIGN KEY (superseded_by_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/023_spare_part_stock_item_integration.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_stock_item_fk') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_stock_item_fk FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/028_asset_movement_operational_hardening.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_origin_movement_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_origin_movement_id_fkey FOREIGN KEY (origin_movement_id) REFERENCES public.asset_movements(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/029_fixed_asset_deployment_valuation.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_responsible_section_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_responsible_section_id_fkey FOREIGN KEY(responsible_section_id) REFERENCES public.sections(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/auditRegistryController.js:35
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.audit_registry_entries'::regclass AND conname='audit_registry_entries_request_id_fkey') THEN
    ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:1142
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_documents'::regclass AND conname='contract_documents_current_version_id_fkey') THEN
    ALTER TABLE public.contract_documents ADD CONSTRAINT contract_documents_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES contract_document_versions(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:828
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_contract_manager_id_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_contract_manager_id_fkey FOREIGN KEY (contract_manager_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:778
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_created_by_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:805
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_end_user_department_id_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_end_user_department_id_fkey FOREIGN KEY (end_user_department_id) REFERENCES departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:875
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_source_request_id_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_source_request_id_fkey FOREIGN KEY (source_request_id) REFERENCES requests(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: controllers/contractsController.js:852
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname='contracts_supplier_id_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_institute_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_reversal_of_movement_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_reversal_of_movement_id_fkey FOREIGN KEY (reversal_of_movement_id) REFERENCES inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/004_inventory_transaction_engine.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_reversed_by_movement_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_reversed_by_movement_id_fkey FOREIGN KEY (reversed_by_movement_id) REFERENCES inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/019_asset_equipment_integration.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintainable_equipment'::regclass AND conname='maintainable_equipment_asset_scope_fk') THEN
    ALTER TABLE public.maintainable_equipment ADD CONSTRAINT maintainable_equipment_asset_scope_fk FOREIGN KEY (institute_id,asset_id)
      REFERENCES public.assets(institute_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/migrations/20261003_procurement_event_overage_decisions.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_item_events'::regclass AND conname='procurement_item_events_overage_decided_by_fkey') THEN
    ALTER TABLE public.procurement_item_events ADD CONSTRAINT procurement_item_events_overage_decided_by_fkey FOREIGN KEY (overage_decided_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/011_central_supply_tracking.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requests'::regclass AND conname='requests_sent_to_central_supply_by_fkey') THEN
    ALTER TABLE public.requests ADD CONSTRAINT requests_sent_to_central_supply_by_fkey FOREIGN KEY (sent_to_central_supply_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: sql/manual/017_fixed_assets_rfid_core.sql
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_business_event_fk') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_business_event_fk FOREIGN KEY(business_event_id) REFERENCES rfid_business_events(id) NOT VALID;
  END IF;
END $constraint$;
-- Constraint source: utils/ensureWarehouseSupplyTables.js:41
DO $constraint$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supplied_items'::regclass AND conname='warehouse_supplied_items_batch_id_fkey') THEN
    ALTER TABLE public.warehouse_supplied_items ADD CONSTRAINT warehouse_supplied_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.warehouse_item_batches(id) NOT VALID;
  END IF;
END $constraint$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_interactions'::regclass AND conname='ai_interactions_user_id_fkey') THEN
    ALTER TABLE public.ai_interactions ADD CONSTRAINT ai_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_interactions'::regclass AND conname='ai_interactions_institute_id_fkey') THEN
    ALTER TABLE public.ai_interactions ADD CONSTRAINT ai_interactions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_tool_executions'::regclass AND conname='ai_tool_executions_interaction_id_fkey') THEN
    ALTER TABLE public.ai_tool_executions ADD CONSTRAINT ai_tool_executions_interaction_id_fkey FOREIGN KEY (interaction_id) REFERENCES public.ai_interactions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_institute_id_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_organization_position_id_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_organization_position_id_fkey FOREIGN KEY (organization_position_id) REFERENCES public.organization_positions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_delegator_user_id_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_delegator_user_id_fkey FOREIGN KEY (delegator_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_delegate_user_id_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_created_by_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_authority_delegations'::regclass AND conname='approval_authority_delegations_revoked_by_fkey') THEN
    ALTER TABLE public.approval_authority_delegations ADD CONSTRAINT approval_authority_delegations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policies'::regclass AND conname='approval_policies_institute_id_fkey') THEN
    ALTER TABLE public.approval_policies ADD CONSTRAINT approval_policies_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policies'::regclass AND conname='approval_policies_created_by_fkey') THEN
    ALTER TABLE public.approval_policies ADD CONSTRAINT approval_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policies'::regclass AND conname='approval_policies_updated_by_fkey') THEN
    ALTER TABLE public.approval_policies ADD CONSTRAINT approval_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_rule_conditions'::regclass AND conname='approval_policy_rule_conditions_policy_rule_id_fkey') THEN
    ALTER TABLE public.approval_policy_rule_conditions ADD CONSTRAINT approval_policy_rule_conditions_policy_rule_id_fkey FOREIGN KEY (policy_rule_id) REFERENCES public.approval_policy_rules(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_rule_steps'::regclass AND conname='approval_policy_rule_steps_policy_rule_id_fkey') THEN
    ALTER TABLE public.approval_policy_rule_steps ADD CONSTRAINT approval_policy_rule_steps_policy_rule_id_fkey FOREIGN KEY (policy_rule_id) REFERENCES public.approval_policy_rules(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_rules'::regclass AND conname='approval_policy_rules_policy_version_id_fkey') THEN
    ALTER TABLE public.approval_policy_rules ADD CONSTRAINT approval_policy_rules_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES public.approval_policy_versions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_differences'::regclass AND conname='approval_policy_shadow_differences_shadow_run_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_differences ADD CONSTRAINT approval_policy_shadow_differences_shadow_run_id_fkey FOREIGN KEY (shadow_run_id) REFERENCES public.approval_policy_shadow_runs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_runs'::regclass AND conname='approval_policy_shadow_runs_request_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_runs ADD CONSTRAINT approval_policy_shadow_runs_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_runs'::regclass AND conname='approval_policy_shadow_runs_policy_version_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_runs ADD CONSTRAINT approval_policy_shadow_runs_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES public.approval_policy_versions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_runs'::regclass AND conname='approval_policy_shadow_runs_generated_by_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_runs ADD CONSTRAINT approval_policy_shadow_runs_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_steps'::regclass AND conname='approval_policy_shadow_steps_shadow_run_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_shadow_run_id_fkey FOREIGN KEY (shadow_run_id) REFERENCES public.approval_policy_shadow_runs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_steps'::regclass AND conname='approval_policy_shadow_steps_resolved_user_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_resolved_user_id_fkey FOREIGN KEY (resolved_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_shadow_steps'::regclass AND conname='approval_policy_shadow_steps_resolved_unit_id_fkey') THEN
    ALTER TABLE public.approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_resolved_unit_id_fkey FOREIGN KEY (resolved_unit_id) REFERENCES public.organization_units(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_versions'::regclass AND conname='approval_policy_versions_approval_policy_id_fkey') THEN
    ALTER TABLE public.approval_policy_versions ADD CONSTRAINT approval_policy_versions_approval_policy_id_fkey FOREIGN KEY (approval_policy_id) REFERENCES public.approval_policies(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_versions'::regclass AND conname='approval_policy_versions_created_by_fkey') THEN
    ALTER TABLE public.approval_policy_versions ADD CONSTRAINT approval_policy_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_versions'::regclass AND conname='approval_policy_versions_validated_by_fkey') THEN
    ALTER TABLE public.approval_policy_versions ADD CONSTRAINT approval_policy_versions_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_versions'::regclass AND conname='approval_policy_versions_activated_by_fkey') THEN
    ALTER TABLE public.approval_policy_versions ADD CONSTRAINT approval_policy_versions_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_snapshot_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.approval_route_snapshots(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_policy_rule_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_policy_rule_id_fkey FOREIGN KEY (policy_rule_id) REFERENCES public.approval_policy_rules(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_policy_step_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_policy_step_id_fkey FOREIGN KEY (policy_step_id) REFERENCES public.approval_policy_rule_steps(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_resolved_unit_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_resolved_unit_id_fkey FOREIGN KEY (resolved_unit_id) REFERENCES public.organization_units(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_resolved_position_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_resolved_position_id_fkey FOREIGN KEY (resolved_position_id) REFERENCES public.organization_positions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_structural_holder_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_structural_holder_id_fkey FOREIGN KEY (structural_holder_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_acting_approver_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_acting_approver_id_fkey FOREIGN KEY (acting_approver_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshot_steps'::regclass AND conname='approval_route_snapshot_steps_delegation_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshot_steps ADD CONSTRAINT approval_route_snapshot_steps_delegation_id_fkey FOREIGN KEY (delegation_id) REFERENCES public.approval_authority_delegations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_institute_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_request_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_policy_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.approval_policies(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_policy_version_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES public.approval_policy_versions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_supersedes_snapshot_id_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_supersedes_snapshot_id_fkey FOREIGN KEY (supersedes_snapshot_id) REFERENCES public.approval_route_snapshots(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_snapshots'::regclass AND conname='approval_route_snapshots_generated_by_fkey') THEN
    ALTER TABLE public.approval_route_snapshots ADD CONSTRAINT approval_route_snapshots_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_generic_item_id_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_manufacturer_id_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.item_manufacturers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_product_uom_id_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_product_uom_id_fkey FOREIGN KEY (product_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_created_by_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_approved_by_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_products'::regclass AND conname='approved_products_institute_id_fkey') THEN
    ALTER TABLE public.approved_products ADD CONSTRAINT approved_products_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_institute_id_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_generic_item_id_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_preferred_approved_product_id_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_preferred_approved_product_id_fkey FOREIGN KEY (preferred_approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_technical_approved_by_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_technical_approved_by_fkey FOREIGN KEY (technical_approved_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_created_by_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_spare_parts'::regclass AND conname='approved_spare_parts_updated_by_fkey') THEN
    ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_categories'::regclass AND conname='asset_categories_institute_id_fkey') THEN
    ALTER TABLE public.asset_categories ADD CONSTRAINT asset_categories_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_categories'::regclass AND conname='asset_categories_parent_category_id_fkey') THEN
    ALTER TABLE public.asset_categories ADD CONSTRAINT asset_categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.asset_categories(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_categories'::regclass AND conname='asset_categories_created_by_fkey') THEN
    ALTER TABLE public.asset_categories ADD CONSTRAINT asset_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_categories'::regclass AND conname='asset_categories_updated_by_fkey') THEN
    ALTER TABLE public.asset_categories ADD CONSTRAINT asset_categories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_institute_id_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_asset_id_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_asset_tag_id_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_asset_tag_id_fkey FOREIGN KEY (asset_tag_id) REFERENCES public.asset_tags(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_rfid_business_event_id_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_rfid_business_event_id_fkey FOREIGN KEY (rfid_business_event_id) REFERENCES public.rfid_business_events(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_acknowledged_by_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_exceptions'::regclass AND conname='asset_exceptions_resolved_by_fkey') THEN
    ALTER TABLE public.asset_exceptions ADD CONSTRAINT asset_exceptions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_session_id_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.asset_inventory_sessions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_observed_location_id_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_observed_location_id_fkey FOREIGN KEY (observed_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_department_id_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_discovered_by_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_discovered_by_fkey FOREIGN KEY (discovered_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_discoveries'::regclass AND conname='asset_inventory_discoveries_registered_asset_id_fkey') THEN
    ALTER TABLE public.asset_inventory_discoveries ADD CONSTRAINT asset_inventory_discoveries_registered_asset_id_fkey FOREIGN KEY (registered_asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_session_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.asset_inventory_sessions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_asset_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_expected_location_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_expected_location_id_fkey FOREIGN KEY (expected_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_expected_department_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_expected_department_id_fkey FOREIGN KEY (expected_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_expected_section_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_expected_section_id_fkey FOREIGN KEY (expected_section_id) REFERENCES public.sections(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_expected_assets'::regclass AND conname='asset_inventory_expected_assets_expected_custodian_user_id_fkey') THEN
    ALTER TABLE public.asset_inventory_expected_assets ADD CONSTRAINT asset_inventory_expected_assets_expected_custodian_user_id_fkey FOREIGN KEY (expected_custodian_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_session_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.asset_inventory_sessions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_expected_asset_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_expected_asset_id_fkey FOREIGN KEY (expected_asset_id) REFERENCES public.asset_inventory_expected_assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_asset_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_observation_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.asset_inventory_observations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_discovery_id_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_discovery_id_fkey FOREIGN KEY (discovery_id) REFERENCES public.asset_inventory_discoveries(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_created_by_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_acknowledged_by_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_resolved_by_fkey') THEN
    ALTER TABLE public.asset_inventory_findings ADD CONSTRAINT asset_inventory_findings_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_number_allocators'::regclass AND conname='asset_inventory_number_allocators_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_number_allocators ADD CONSTRAINT asset_inventory_number_allocators_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_session_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.asset_inventory_sessions(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_asset_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_observed_location_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_observed_location_id_fkey FOREIGN KEY (observed_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_observed_department_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_observed_department_id_fkey FOREIGN KEY (observed_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_observed_custodian_user_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_observed_custodian_user_id_fkey FOREIGN KEY (observed_custodian_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_observed_by_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_observed_by_fkey FOREIGN KEY (observed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_rfid_read_event_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_rfid_read_event_id_fkey FOREIGN KEY (rfid_read_event_id) REFERENCES public.rfid_read_events(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_observations'::regclass AND conname='asset_inventory_observations_rfid_business_event_id_fkey') THEN
    ALTER TABLE public.asset_inventory_observations ADD CONSTRAINT asset_inventory_observations_rfid_business_event_id_fkey FOREIGN KEY (rfid_business_event_id) REFERENCES public.rfid_business_events(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_resolutions'::regclass AND conname='asset_inventory_resolutions_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_resolutions ADD CONSTRAINT asset_inventory_resolutions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_resolutions'::regclass AND conname='asset_inventory_resolutions_finding_id_fkey') THEN
    ALTER TABLE public.asset_inventory_resolutions ADD CONSTRAINT asset_inventory_resolutions_finding_id_fkey FOREIGN KEY (finding_id) REFERENCES public.asset_inventory_findings(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_resolutions'::regclass AND conname='asset_inventory_resolutions_created_by_fkey') THEN
    ALTER TABLE public.asset_inventory_resolutions ADD CONSTRAINT asset_inventory_resolutions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_institute_id_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_scope_location_id_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_scope_location_id_fkey FOREIGN KEY (scope_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_scope_department_id_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_scope_department_id_fkey FOREIGN KEY (scope_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_started_by_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_completed_by_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_cancelled_by_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_created_by_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND conname='asset_inventory_sessions_updated_by_fkey') THEN
    ALTER TABLE public.asset_inventory_sessions ADD CONSTRAINT asset_inventory_sessions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_institute_id_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_parent_location_id_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_parent_location_id_fkey FOREIGN KEY (parent_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_department_id_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_section_id_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_created_by_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_locations'::regclass AND conname='asset_locations_updated_by_fkey') THEN
    ALTER TABLE public.asset_locations ADD CONSTRAINT asset_locations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_institute_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_asset_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_from_department_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_from_department_id_fkey FOREIGN KEY (from_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_from_location_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_to_department_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_to_department_id_fkey FOREIGN KEY (to_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_to_location_id_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_requested_by_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_approved_by_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_dispatched_by_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_dispatched_by_fkey FOREIGN KEY (dispatched_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_received_by_fkey') THEN
    ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_number_allocators'::regclass AND conname='asset_number_allocators_institute_id_fkey') THEN
    ALTER TABLE public.asset_number_allocators ADD CONSTRAINT asset_number_allocators_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_tags'::regclass AND conname='asset_tags_institute_id_fkey') THEN
    ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_tags'::regclass AND conname='asset_tags_asset_id_fkey') THEN
    ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_tags'::regclass AND conname='asset_tags_installed_by_fkey') THEN
    ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_tags'::regclass AND conname='asset_tags_retired_by_fkey') THEN
    ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_retired_by_fkey FOREIGN KEY (retired_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_institute_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_asset_category_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_asset_category_id_fkey FOREIGN KEY (asset_category_id) REFERENCES public.asset_categories(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_stock_item_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_purchase_request_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_purchase_request_id_fkey FOREIGN KEY (purchase_request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_requested_item_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_purchase_order_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_purchase_order_item_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_goods_receipt_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_goods_receipt_id_fkey FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_goods_receipt_item_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_goods_receipt_item_id_fkey FOREIGN KEY (goods_receipt_item_id) REFERENCES public.goods_receipt_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_supplier_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_responsible_department_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_responsible_department_id_fkey FOREIGN KEY (responsible_department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_current_location_id_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_current_location_id_fkey FOREIGN KEY (current_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_created_by_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assets'::regclass AND conname='assets_updated_by_fkey') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_ai_extractions'::regclass AND conname='contract_ai_extractions_contract_id_fkey') THEN
    ALTER TABLE public.contract_ai_extractions ADD CONSTRAINT contract_ai_extractions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_ai_extractions'::regclass AND conname='contract_ai_extractions_document_id_fkey') THEN
    ALTER TABLE public.contract_ai_extractions ADD CONSTRAINT contract_ai_extractions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.contract_documents(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_ai_extractions'::regclass AND conname='contract_ai_extractions_document_version_id_fkey') THEN
    ALTER TABLE public.contract_ai_extractions ADD CONSTRAINT contract_ai_extractions_document_version_id_fkey FOREIGN KEY (document_version_id) REFERENCES public.contract_document_versions(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_ai_extractions'::regclass AND conname='contract_ai_extractions_created_by_fkey') THEN
    ALTER TABLE public.contract_ai_extractions ADD CONSTRAINT contract_ai_extractions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_alerts'::regclass AND conname='contract_alerts_contract_id_fkey') THEN
    ALTER TABLE public.contract_alerts ADD CONSTRAINT contract_alerts_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_amendments'::regclass AND conname='contract_amendments_contract_id_fkey') THEN
    ALTER TABLE public.contract_amendments ADD CONSTRAINT contract_amendments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_approvals'::regclass AND conname='contract_approvals_contract_id_fkey') THEN
    ALTER TABLE public.contract_approvals ADD CONSTRAINT contract_approvals_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_clause_assignments'::regclass AND conname='contract_clause_assignments_contract_id_fkey') THEN
    ALTER TABLE public.contract_clause_assignments ADD CONSTRAINT contract_clause_assignments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_clause_assignments'::regclass AND conname='contract_clause_assignments_clause_id_fkey') THEN
    ALTER TABLE public.contract_clause_assignments ADD CONSTRAINT contract_clause_assignments_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.contract_clauses(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_consumption'::regclass AND conname='contract_consumption_contract_id_fkey') THEN
    ALTER TABLE public.contract_consumption ADD CONSTRAINT contract_consumption_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_consumption'::regclass AND conname='contract_consumption_invoice_id_fkey') THEN
    ALTER TABLE public.contract_consumption ADD CONSTRAINT contract_consumption_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.contract_invoices(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_document_versions'::regclass AND conname='contract_document_versions_document_id_fkey') THEN
    ALTER TABLE public.contract_document_versions ADD CONSTRAINT contract_document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.contract_documents(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_document_versions'::regclass AND conname='contract_document_versions_contract_id_fkey') THEN
    ALTER TABLE public.contract_document_versions ADD CONSTRAINT contract_document_versions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_document_versions'::regclass AND conname='contract_document_versions_uploaded_by_fkey') THEN
    ALTER TABLE public.contract_document_versions ADD CONSTRAINT contract_document_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_documents'::regclass AND conname='contract_documents_contract_id_fkey') THEN
    ALTER TABLE public.contract_documents ADD CONSTRAINT contract_documents_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_documents'::regclass AND conname='contract_documents_created_by_fkey') THEN
    ALTER TABLE public.contract_documents ADD CONSTRAINT contract_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_institute_id_fkey') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_contract_id_fkey') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_created_by_fkey') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_updated_by_fkey') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_equipment_scope_fk') THEN
    ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_equipment_scope_fk FOREIGN KEY (institute_id,equipment_id)
      REFERENCES public.maintainable_equipment(institute_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_invoices'::regclass AND conname='contract_invoices_contract_id_fkey') THEN
    ALTER TABLE public.contract_invoices ADD CONSTRAINT contract_invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_items'::regclass AND conname='contract_items_contract_id_fkey') THEN
    ALTER TABLE public.contract_items ADD CONSTRAINT contract_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_items'::regclass AND conname='contract_items_generic_item_id_fkey') THEN
    ALTER TABLE public.contract_items ADD CONSTRAINT contract_items_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_items'::regclass AND conname='contract_items_approved_product_id_fkey') THEN
    ALTER TABLE public.contract_items ADD CONSTRAINT contract_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_items'::regclass AND conname='contract_items_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.contract_items ADD CONSTRAINT contract_items_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_legal_reviews'::regclass AND conname='contract_legal_reviews_contract_id_fkey') THEN
    ALTER TABLE public.contract_legal_reviews ADD CONSTRAINT contract_legal_reviews_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_logs'::regclass AND conname='contract_logs_contract_id_fkey') THEN
    ALTER TABLE public.contract_logs ADD CONSTRAINT contract_logs_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_negotiations'::regclass AND conname='contract_negotiations_contract_id_fkey') THEN
    ALTER TABLE public.contract_negotiations ADD CONSTRAINT contract_negotiations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_obligations'::regclass AND conname='contract_obligations_contract_id_fkey') THEN
    ALTER TABLE public.contract_obligations ADD CONSTRAINT contract_obligations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_payments'::regclass AND conname='contract_payments_contract_id_fkey') THEN
    ALTER TABLE public.contract_payments ADD CONSTRAINT contract_payments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_payments'::regclass AND conname='contract_payments_invoice_id_fkey') THEN
    ALTER TABLE public.contract_payments ADD CONSTRAINT contract_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.contract_invoices(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_renewal_events'::regclass AND conname='contract_renewal_events_contract_id_fkey') THEN
    ALTER TABLE public.contract_renewal_events ADD CONSTRAINT contract_renewal_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_required_documents'::regclass AND conname='contract_required_documents_contract_id_fkey') THEN
    ALTER TABLE public.contract_required_documents ADD CONSTRAINT contract_required_documents_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_risk_assessments'::regclass AND conname='contract_risk_assessments_contract_id_fkey') THEN
    ALTER TABLE public.contract_risk_assessments ADD CONSTRAINT contract_risk_assessments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_risk_assessments'::regclass AND conname='contract_risk_assessments_assessed_by_fkey') THEN
    ALTER TABLE public.contract_risk_assessments ADD CONSTRAINT contract_risk_assessments_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_sla_events'::regclass AND conname='contract_sla_events_contract_id_fkey') THEN
    ALTER TABLE public.contract_sla_events ADD CONSTRAINT contract_sla_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_versions'::regclass AND conname='contract_versions_contract_id_fkey') THEN
    ALTER TABLE public.contract_versions ADD CONSTRAINT contract_versions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_item_follow_up_notes'::regclass AND conname='department_item_follow_up_notes_request_id_fkey') THEN
    ALTER TABLE public.department_item_follow_up_notes ADD CONSTRAINT department_item_follow_up_notes_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_item_follow_up_notes'::regclass AND conname='department_item_follow_up_notes_requested_item_id_fkey') THEN
    ALTER TABLE public.department_item_follow_up_notes ADD CONSTRAINT department_item_follow_up_notes_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_item_follow_up_notes'::regclass AND conname='department_item_follow_up_notes_department_id_fkey') THEN
    ALTER TABLE public.department_item_follow_up_notes ADD CONSTRAINT department_item_follow_up_notes_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_item_follow_up_notes'::regclass AND conname='department_item_follow_up_notes_section_id_fkey') THEN
    ALTER TABLE public.department_item_follow_up_notes ADD CONSTRAINT department_item_follow_up_notes_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_item_follow_up_notes'::regclass AND conname='department_item_follow_up_notes_created_by_fkey') THEN
    ALTER TABLE public.department_item_follow_up_notes ADD CONSTRAINT department_item_follow_up_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_priority_rankings'::regclass AND conname='department_priority_rankings_procurement_case_id_fkey') THEN
    ALTER TABLE public.department_priority_rankings ADD CONSTRAINT department_priority_rankings_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_priority_rankings'::regclass AND conname='department_priority_rankings_ranked_by_fkey') THEN
    ALTER TABLE public.department_priority_rankings ADD CONSTRAINT department_priority_rankings_ranked_by_fkey FOREIGN KEY (ranked_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.document_branding_settings'::regclass AND conname='document_branding_settings_updated_by_fkey') THEN
    ALTER TABLE public.document_branding_settings ADD CONSTRAINT document_branding_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.employee_tasks'::regclass AND conname='employee_tasks_assigned_to_fkey') THEN
    ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.employee_tasks'::regclass AND conname='employee_tasks_assigned_by_fkey') THEN
    ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_item_merges'::regclass AND conname='generic_item_merges_source_generic_item_id_fkey') THEN
    ALTER TABLE public.generic_item_merges ADD CONSTRAINT generic_item_merges_source_generic_item_id_fkey FOREIGN KEY (source_generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_item_merges'::regclass AND conname='generic_item_merges_target_generic_item_id_fkey') THEN
    ALTER TABLE public.generic_item_merges ADD CONSTRAINT generic_item_merges_target_generic_item_id_fkey FOREIGN KEY (target_generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_item_merges'::regclass AND conname='generic_item_merges_reviewed_by_fkey') THEN
    ALTER TABLE public.generic_item_merges ADD CONSTRAINT generic_item_merges_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_category_id_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.item_categories(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_base_uom_id_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_inventory_uom_id_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_inventory_uom_id_fkey FOREIGN KEY (inventory_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_purchasing_uom_id_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_purchasing_uom_id_fkey FOREIGN KEY (purchasing_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_created_by_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_updated_by_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_approved_by_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.generic_items'::regclass AND conname='generic_items_institute_id_fkey') THEN
    ALTER TABLE public.generic_items ADD CONSTRAINT generic_items_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_count_lines'::regclass AND conname='inventory_cycle_count_lines_cycle_count_id_fkey') THEN
    ALTER TABLE public.inventory_cycle_count_lines ADD CONSTRAINT inventory_cycle_count_lines_cycle_count_id_fkey FOREIGN KEY (cycle_count_id) REFERENCES public.inventory_cycle_counts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_count_lines'::regclass AND conname='inventory_cycle_count_lines_stock_item_id_fkey') THEN
    ALTER TABLE public.inventory_cycle_count_lines ADD CONSTRAINT inventory_cycle_count_lines_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_count_lines'::regclass AND conname='inventory_cycle_count_lines_warehouse_stock_level_id_fkey') THEN
    ALTER TABLE public.inventory_cycle_count_lines ADD CONSTRAINT inventory_cycle_count_lines_warehouse_stock_level_id_fkey FOREIGN KEY (warehouse_stock_level_id) REFERENCES public.warehouse_stock_levels(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_count_lines'::regclass AND conname='inventory_cycle_count_lines_counted_by_fkey') THEN
    ALTER TABLE public.inventory_cycle_count_lines ADD CONSTRAINT inventory_cycle_count_lines_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_count_lines'::regclass AND conname='inventory_cycle_count_lines_posted_movement_id_fkey') THEN
    ALTER TABLE public.inventory_cycle_count_lines ADD CONSTRAINT inventory_cycle_count_lines_posted_movement_id_fkey FOREIGN KEY (posted_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_counts'::regclass AND conname='inventory_cycle_counts_warehouse_id_fkey') THEN
    ALTER TABLE public.inventory_cycle_counts ADD CONSTRAINT inventory_cycle_counts_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_counts'::regclass AND conname='inventory_cycle_counts_opened_by_fkey') THEN
    ALTER TABLE public.inventory_cycle_counts ADD CONSTRAINT inventory_cycle_counts_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_counts'::regclass AND conname='inventory_cycle_counts_reviewed_by_fkey') THEN
    ALTER TABLE public.inventory_cycle_counts ADD CONSTRAINT inventory_cycle_counts_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_cycle_counts'::regclass AND conname='inventory_cycle_counts_posted_by_fkey') THEN
    ALTER TABLE public.inventory_cycle_counts ADD CONSTRAINT inventory_cycle_counts_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservation_allocations'::regclass AND conname='inventory_reservation_allocations_reservation_id_fkey') THEN
    ALTER TABLE public.inventory_reservation_allocations ADD CONSTRAINT inventory_reservation_allocations_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservation_allocations'::regclass AND conname='inventory_reservation_allocations_warehouse_stock_level_id_fkey') THEN
    ALTER TABLE public.inventory_reservation_allocations ADD CONSTRAINT inventory_reservation_allocations_warehouse_stock_level_id_fkey FOREIGN KEY (warehouse_stock_level_id) REFERENCES public.warehouse_stock_levels(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservation_issue_operations'::regclass AND conname='inventory_reservation_issue_operations_reservation_id_fkey') THEN
    ALTER TABLE public.inventory_reservation_issue_operations ADD CONSTRAINT inventory_reservation_issue_operations_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservation_issue_operations'::regclass AND conname='inventory_reservation_issue_operations_inventory_movement_id_fk') THEN
    ALTER TABLE public.inventory_reservation_issue_operations ADD CONSTRAINT inventory_reservation_issue_operations_inventory_movement_id_fk FOREIGN KEY (inventory_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservation_issue_operations'::regclass AND conname='inventory_reservation_issue_operations_created_by_fkey') THEN
    ALTER TABLE public.inventory_reservation_issue_operations ADD CONSTRAINT inventory_reservation_issue_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_warehouse_id_fkey') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_stock_item_id_fkey') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_created_by_fkey') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_released_by_fkey') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_reservations'::regclass AND conname='inventory_reservations_consumed_by_fkey') THEN
    ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transaction_allocations'::regclass AND conname='inventory_transaction_allocations_inventory_transaction_id_fkey') THEN
    ALTER TABLE public.inventory_transaction_allocations ADD CONSTRAINT inventory_transaction_allocations_inventory_transaction_id_fkey FOREIGN KEY (inventory_transaction_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transaction_allocations'::regclass AND conname='inventory_transaction_allocations_warehouse_stock_level_id_fkey') THEN
    ALTER TABLE public.inventory_transaction_allocations ADD CONSTRAINT inventory_transaction_allocations_warehouse_stock_level_id_fkey FOREIGN KEY (warehouse_stock_level_id) REFERENCES public.warehouse_stock_levels(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transaction_allocations'::regclass AND conname='inventory_transaction_allocations_warehouse_id_fkey') THEN
    ALTER TABLE public.inventory_transaction_allocations ADD CONSTRAINT inventory_transaction_allocations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transaction_allocations'::regclass AND conname='inventory_transaction_allocations_stock_item_id_fkey') THEN
    ALTER TABLE public.inventory_transaction_allocations ADD CONSTRAINT inventory_transaction_allocations_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_allocation_links'::regclass AND conname='inventory_transfer_allocation_links_transfer_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_allocation_links ADD CONSTRAINT inventory_transfer_allocation_links_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.warehouse_transfer_requests(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_allocation_links'::regclass AND conname='inventory_transfer_allocation_links_transfer_line_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_allocation_links ADD CONSTRAINT inventory_transfer_allocation_links_transfer_line_id_fkey FOREIGN KEY (transfer_line_id) REFERENCES public.warehouse_transfer_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_allocation_links'::regclass AND conname='inventory_transfer_allocation_links_dispatch_movement_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_allocation_links ADD CONSTRAINT inventory_transfer_allocation_links_dispatch_movement_id_fkey FOREIGN KEY (dispatch_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_allocation_links'::regclass AND conname='inventory_transfer_allocation_links_dispatch_allocation_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_allocation_links ADD CONSTRAINT inventory_transfer_allocation_links_dispatch_allocation_id_fkey FOREIGN KEY (dispatch_allocation_id) REFERENCES public.inventory_transaction_allocations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_movement_links'::regclass AND conname='inventory_transfer_movement_links_transfer_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_movement_links ADD CONSTRAINT inventory_transfer_movement_links_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.warehouse_transfer_requests(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_movement_links'::regclass AND conname='inventory_transfer_movement_links_transfer_line_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_movement_links ADD CONSTRAINT inventory_transfer_movement_links_transfer_line_id_fkey FOREIGN KEY (transfer_line_id) REFERENCES public.warehouse_transfer_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_movement_links'::regclass AND conname='inventory_transfer_movement_links_dispatch_movement_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_movement_links ADD CONSTRAINT inventory_transfer_movement_links_dispatch_movement_id_fkey FOREIGN KEY (dispatch_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_receipt_operations'::regclass AND conname='inventory_transfer_receipt_operations_transfer_id_fkey') THEN
    ALTER TABLE public.inventory_transfer_receipt_operations ADD CONSTRAINT inventory_transfer_receipt_operations_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.warehouse_transfer_requests(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transfer_receipt_operations'::regclass AND conname='inventory_transfer_receipt_operations_created_by_fkey') THEN
    ALTER TABLE public.inventory_transfer_receipt_operations ADD CONSTRAINT inventory_transfer_receipt_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_override_decisions'::regclass AND conname='invoice_match_override_decisions_invoice_match_result_id_fkey') THEN
    ALTER TABLE public.invoice_match_override_decisions ADD CONSTRAINT invoice_match_override_decisions_invoice_match_result_id_fkey FOREIGN KEY (invoice_match_result_id) REFERENCES public.invoice_match_results(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_override_decisions'::regclass AND conname='invoice_match_override_decisions_actor_id_fkey') THEN
    ALTER TABLE public.invoice_match_override_decisions ADD CONSTRAINT invoice_match_override_decisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_duplicate_reviews'::regclass AND conname='item_duplicate_reviews_reviewed_by_fkey') THEN
    ALTER TABLE public.item_duplicate_reviews ADD CONSTRAINT item_duplicate_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_aliases'::regclass AND conname='item_master_aliases_generic_item_id_fkey') THEN
    ALTER TABLE public.item_master_aliases ADD CONSTRAINT item_master_aliases_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_aliases'::regclass AND conname='item_master_aliases_created_by_fkey') THEN
    ALTER TABLE public.item_master_aliases ADD CONSTRAINT item_master_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_audit_events'::regclass AND conname='item_master_audit_events_actor_id_fkey') THEN
    ALTER TABLE public.item_master_audit_events ADD CONSTRAINT item_master_audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_audit_events'::regclass AND conname='item_master_audit_events_request_id_fkey') THEN
    ALTER TABLE public.item_master_audit_events ADD CONSTRAINT item_master_audit_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_audit_events'::regclass AND conname='item_master_audit_events_requested_item_id_fkey') THEN
    ALTER TABLE public.item_master_audit_events ADD CONSTRAINT item_master_audit_events_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entries'::regclass AND conname='journal_entries_request_id_fkey') THEN
    ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entries'::regclass AND conname='journal_entries_posted_by_fkey') THEN
    ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entry_lines'::regclass AND conname='journal_entry_lines_journal_entry_id_fkey') THEN
    ALTER TABLE public.journal_entry_lines ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entry_lines'::regclass AND conname='journal_entry_lines_cost_center_id_fkey') THEN
    ALTER TABLE public.journal_entry_lines ADD CONSTRAINT journal_entry_lines_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.finance_cost_centers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.legacy_item_mappings'::regclass AND conname='legacy_item_mappings_generic_item_id_fkey') THEN
    ALTER TABLE public.legacy_item_mappings ADD CONSTRAINT legacy_item_mappings_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.legacy_item_mappings'::regclass AND conname='legacy_item_mappings_mapped_by_fkey') THEN
    ALTER TABLE public.legacy_item_mappings ADD CONSTRAINT legacy_item_mappings_mapped_by_fkey FOREIGN KEY (mapped_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintainable_equipment'::regclass AND conname='maintainable_equipment_institute_id_fkey') THEN
    ALTER TABLE public.maintainable_equipment ADD CONSTRAINT maintainable_equipment_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintainable_equipment'::regclass AND conname='maintainable_equipment_department_id_fkey') THEN
    ALTER TABLE public.maintainable_equipment ADD CONSTRAINT maintainable_equipment_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_part_inventory_operations'::regclass AND conname='maintenance_part_inventory_operations_institute_id_fkey') THEN
    ALTER TABLE public.maintenance_part_inventory_operations ADD CONSTRAINT maintenance_part_inventory_operations_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_part_inventory_operations'::regclass AND conname='maintenance_part_inventory_operations_reservation_id_fkey') THEN
    ALTER TABLE public.maintenance_part_inventory_operations ADD CONSTRAINT maintenance_part_inventory_operations_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_part_inventory_operations'::regclass AND conname='maintenance_part_inventory_operations_inventory_movement_id_fke') THEN
    ALTER TABLE public.maintenance_part_inventory_operations ADD CONSTRAINT maintenance_part_inventory_operations_inventory_movement_id_fke FOREIGN KEY (inventory_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_part_inventory_operations'::regclass AND conname='maintenance_part_inventory_operations_created_by_fkey') THEN
    ALTER TABLE public.maintenance_part_inventory_operations ADD CONSTRAINT maintenance_part_inventory_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_part_inventory_operations'::regclass AND conname='maintenance_part_inventory_operations_contract_fk_251') THEN
    ALTER TABLE public.maintenance_part_inventory_operations ADD CONSTRAINT maintenance_part_inventory_operations_contract_fk_251 FOREIGN KEY(institute_id,work_order_part_id) REFERENCES public.maintenance_work_order_parts(institute_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_allocators'::regclass AND conname='maintenance_work_order_allocators_institute_id_fkey') THEN
    ALTER TABLE public.maintenance_work_order_allocators ADD CONSTRAINT maintenance_work_order_allocators_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_institute_id_fkey') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_stock_item_id_fkey') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_created_by_fkey') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_reservation_id_fkey') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_issued_inventory_movement_id_fkey') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_issued_inventory_movement_id_fkey FOREIGN KEY (issued_inventory_movement_id) REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_contract_fk_258') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_contract_fk_258 FOREIGN KEY(institute_id,work_order_id) REFERENCES public.maintenance_work_orders(institute_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_order_parts'::regclass AND conname='maintenance_work_order_parts_contract_fk_259') THEN
    ALTER TABLE public.maintenance_work_order_parts ADD CONSTRAINT maintenance_work_order_parts_contract_fk_259 FOREIGN KEY(institute_id,spare_part_id) REFERENCES public.approved_spare_parts(institute_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_institute_id_fkey') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_assigned_to_fkey') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_created_by_fkey') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_updated_by_fkey') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_contract_fk_264') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_contract_fk_264 FOREIGN KEY(institute_id,equipment_id) REFERENCES public.maintainable_equipment(institute_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.maintenance_work_orders'::regclass AND conname='maintenance_work_orders_contract_fk_265') THEN
    ALTER TABLE public.maintenance_work_orders ADD CONSTRAINT maintenance_work_orders_contract_fk_265 FOREIGN KEY(institute_id,coverage_id,equipment_id) REFERENCES public.contract_equipment_coverage(institute_id,id,equipment_id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_outbox'::regclass AND conname='notification_outbox_recipient_user_id_fkey') THEN
    ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_institute_id_fkey') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_organization_unit_id') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_organization_unit_id FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_legacy_user_id_fkey') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_legacy_user_id_fkey FOREIGN KEY (legacy_user_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_organization_head_po') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_organization_head_po FOREIGN KEY (organization_head_position_id) REFERENCES public.organization_positions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_organization_head_us') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_organization_head_us FOREIGN KEY (organization_head_user_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_head_reconciliation_decisions'::regclass AND conname='organization_head_reconciliation_decisions_decided_by_fkey') THEN
    ALTER TABLE public.organization_head_reconciliation_decisions ADD CONSTRAINT organization_head_reconciliation_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_organization_unit_id_fkey') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_organization_unit_id_fkey FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_user_id_fkey') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_created_by_fkey') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_positions'::regclass AND conname='organization_positions_updated_by_fkey') THEN
    ALTER TABLE public.organization_positions ADD CONSTRAINT organization_positions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_institute_id_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_parent_unit_id_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_parent_unit_id_fkey FOREIGN KEY (parent_unit_id) REFERENCES public.organization_units(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_department_id_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_section_id_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_created_by_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_units'::regclass AND conname='organization_units_updated_by_fkey') THEN
    ALTER TABLE public.organization_units ADD CONSTRAINT organization_units_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_request_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_requested_item_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_resolved_generic_item_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_resolved_generic_item_id_fkey FOREIGN KEY (resolved_generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_resolved_product_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_resolved_product_id_fkey FOREIGN KEY (resolved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_requester_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_assigned_steward_id_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_assigned_steward_id_fkey FOREIGN KEY (assigned_steward_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pending_item_requests'::regclass AND conname='pending_item_requests_resolved_by_fkey') THEN
    ALTER TABLE public.pending_item_requests ADD CONSTRAINT pending_item_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.print_service_requests'::regclass AND conname='print_service_requests_requester_id_fkey') THEN
    ALTER TABLE public.print_service_requests ADD CONSTRAINT print_service_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.print_service_requests'::regclass AND conname='print_service_requests_department_id_fkey') THEN
    ALTER TABLE public.print_service_requests ADD CONSTRAINT print_service_requests_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.print_service_requests'::regclass AND conname='print_service_requests_accepted_by_fkey') THEN
    ALTER TABLE public.print_service_requests ADD CONSTRAINT print_service_requests_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.print_service_requests'::regclass AND conname='print_service_requests_completed_by_fkey') THEN
    ALTER TABLE public.print_service_requests ADD CONSTRAINT print_service_requests_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.print_service_settings'::regclass AND conname='print_service_settings_updated_by_fkey') THEN
    ALTER TABLE public.print_service_settings ADD CONSTRAINT print_service_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_request_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_request_item_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_request_item_id_fkey FOREIGN KEY (request_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_supplier_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_actor_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_approved_product_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_awards'::regclass AND conname='procurement_awards_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.procurement_awards ADD CONSTRAINT procurement_awards_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_case_activities'::regclass AND conname='procurement_case_activities_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_case_activities ADD CONSTRAINT procurement_case_activities_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_case_activities'::regclass AND conname='procurement_case_activities_actor_id_fkey') THEN
    ALTER TABLE public.procurement_case_activities ADD CONSTRAINT procurement_case_activities_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_case_activities'::regclass AND conname='procurement_case_activities_supplier_id_fkey') THEN
    ALTER TABLE public.procurement_case_activities ADD CONSTRAINT procurement_case_activities_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_case_complexity_factors'::regclass AND conname='procurement_case_complexity_factors_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_case_complexity_factors ADD CONSTRAINT procurement_case_complexity_factors_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_case_complexity_factors'::regclass AND conname='procurement_case_complexity_factors_assessed_by_fkey') THEN
    ALTER TABLE public.procurement_case_complexity_factors ADD CONSTRAINT procurement_case_complexity_factors_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_request_id_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_requested_item_id_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_institute_id_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_department_id_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_assigned_buyer_id_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_assigned_buyer_id_fkey FOREIGN KEY (assigned_buyer_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_created_by_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_cases'::regclass AND conname='procurement_cases_updated_by_fkey') THEN
    ALTER TABLE public.procurement_cases ADD CONSTRAINT procurement_cases_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_request_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_department_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_section_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_selected_offer_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_selected_offer_id_fkey FOREIGN KEY (selected_offer_id) REFERENCES public.procurement_evaluation_offers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_created_by_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_cases'::regclass AND conname='procurement_evaluation_cases_finalized_by_fkey') THEN
    ALTER TABLE public.procurement_evaluation_cases ADD CONSTRAINT procurement_evaluation_cases_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_criteria'::regclass AND conname='procurement_evaluation_criteria_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_criteria ADD CONSTRAINT procurement_evaluation_criteria_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_offer_test_costs'::regclass AND conname='procurement_evaluation_offer_test_costs_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_offer_test_costs ADD CONSTRAINT procurement_evaluation_offer_test_costs_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_offer_test_costs'::regclass AND conname='procurement_evaluation_offer_test_costs_offer_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_offer_test_costs ADD CONSTRAINT procurement_evaluation_offer_test_costs_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.procurement_evaluation_offers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_offer_test_costs'::regclass AND conname='procurement_evaluation_offer_test_costs_test_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_offer_test_costs ADD CONSTRAINT procurement_evaluation_offer_test_costs_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.procurement_evaluation_tests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_offers'::regclass AND conname='procurement_evaluation_offers_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_offers ADD CONSTRAINT procurement_evaluation_offers_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_offers'::regclass AND conname='procurement_evaluation_offers_supplier_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_offers ADD CONSTRAINT procurement_evaluation_offers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_results'::regclass AND conname='procurement_evaluation_results_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_results ADD CONSTRAINT procurement_evaluation_results_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_results'::regclass AND conname='procurement_evaluation_results_offer_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_results ADD CONSTRAINT procurement_evaluation_results_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.procurement_evaluation_offers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_scores'::regclass AND conname='procurement_evaluation_scores_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_scores ADD CONSTRAINT procurement_evaluation_scores_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_scores'::regclass AND conname='procurement_evaluation_scores_offer_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_scores ADD CONSTRAINT procurement_evaluation_scores_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.procurement_evaluation_offers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_scores'::regclass AND conname='procurement_evaluation_scores_criteria_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_scores ADD CONSTRAINT procurement_evaluation_scores_criteria_id_fkey FOREIGN KEY (criteria_id) REFERENCES public.procurement_evaluation_criteria(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_scores'::regclass AND conname='procurement_evaluation_scores_evaluator_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_scores ADD CONSTRAINT procurement_evaluation_scores_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_evaluation_tests'::regclass AND conname='procurement_evaluation_tests_evaluation_case_id_fkey') THEN
    ALTER TABLE public.procurement_evaluation_tests ADD CONSTRAINT procurement_evaluation_tests_evaluation_case_id_fkey FOREIGN KEY (evaluation_case_id) REFERENCES public.procurement_evaluation_cases(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_identity_policy'::regclass AND conname='procurement_identity_policy_updated_by_fkey') THEN
    ALTER TABLE public.procurement_identity_policy ADD CONSTRAINT procurement_identity_policy_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_item_events'::regclass AND conname='procurement_item_events_request_id_fkey') THEN
    ALTER TABLE public.procurement_item_events ADD CONSTRAINT procurement_item_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_item_events'::regclass AND conname='procurement_item_events_requested_item_id_fkey') THEN
    ALTER TABLE public.procurement_item_events ADD CONSTRAINT procurement_item_events_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_item_events'::regclass AND conname='procurement_item_events_procurement_user_id_fkey') THEN
    ALTER TABLE public.procurement_item_events ADD CONSTRAINT procurement_item_events_procurement_user_id_fkey FOREIGN KEY (procurement_user_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_item_events'::regclass AND conname='procurement_item_events_supplier_id_fkey') THEN
    ALTER TABLE public.procurement_item_events ADD CONSTRAINT procurement_item_events_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_group_members'::regclass AND conname='procurement_priority_group_members_group_id_fkey') THEN
    ALTER TABLE public.procurement_priority_group_members ADD CONSTRAINT procurement_priority_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.procurement_priority_groups(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_group_members'::regclass AND conname='procurement_priority_group_members_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_priority_group_members ADD CONSTRAINT procurement_priority_group_members_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_group_members'::regclass AND conname='procurement_priority_group_members_added_by_fkey') THEN
    ALTER TABLE public.procurement_priority_group_members ADD CONSTRAINT procurement_priority_group_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_groups'::regclass AND conname='procurement_priority_groups_created_by_fkey') THEN
    ALTER TABLE public.procurement_priority_groups ADD CONSTRAINT procurement_priority_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_groups'::regclass AND conname='procurement_priority_groups_updated_by_fkey') THEN
    ALTER TABLE public.procurement_priority_groups ADD CONSTRAINT procurement_priority_groups_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_history'::regclass AND conname='procurement_priority_history_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_priority_history ADD CONSTRAINT procurement_priority_history_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_history'::regclass AND conname='procurement_priority_history_calculated_by_fkey') THEN
    ALTER TABLE public.procurement_priority_history ADD CONSTRAINT procurement_priority_history_calculated_by_fkey FOREIGN KEY (calculated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_profiles'::regclass AND conname='procurement_priority_profiles_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_priority_profiles ADD CONSTRAINT procurement_priority_profiles_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_priority_profiles'::regclass AND conname='procurement_priority_profiles_scm_assessed_by_fkey') THEN
    ALTER TABLE public.procurement_priority_profiles ADD CONSTRAINT procurement_priority_profiles_scm_assessed_by_fkey FOREIGN KEY (scm_assessed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_value_events'::regclass AND conname='procurement_value_events_procurement_case_id_fkey') THEN
    ALTER TABLE public.procurement_value_events ADD CONSTRAINT procurement_value_events_procurement_case_id_fkey FOREIGN KEY (procurement_case_id) REFERENCES public.procurement_cases(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_value_events'::regclass AND conname='procurement_value_events_entered_by_fkey') THEN
    ALTER TABLE public.procurement_value_events ADD CONSTRAINT procurement_value_events_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_value_events'::regclass AND conname='procurement_value_events_verified_by_fkey') THEN
    ALTER TABLE public.procurement_value_events ADD CONSTRAINT procurement_value_events_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.project_department_visibility'::regclass AND conname='project_department_visibility_project_id_fkey') THEN
    ALTER TABLE public.project_department_visibility ADD CONSTRAINT project_department_visibility_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.project_department_visibility'::regclass AND conname='project_department_visibility_department_id_fkey') THEN
    ALTER TABLE public.project_department_visibility ADD CONSTRAINT project_department_visibility_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_auto_assignment_rules'::regclass AND conname='request_auto_assignment_rules_warehouse_id_fkey') THEN
    ALTER TABLE public.request_auto_assignment_rules ADD CONSTRAINT request_auto_assignment_rules_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_auto_assignment_rules'::regclass AND conname='request_auto_assignment_rules_assignee_user_id_fkey') THEN
    ALTER TABLE public.request_auto_assignment_rules ADD CONSTRAINT request_auto_assignment_rules_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_auto_assignment_rules'::regclass AND conname='request_auto_assignment_rules_created_by_fkey') THEN
    ALTER TABLE public.request_auto_assignment_rules ADD CONSTRAINT request_auto_assignment_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_auto_assignment_rules'::regclass AND conname='request_auto_assignment_rules_updated_by_fkey') THEN
    ALTER TABLE public.request_auto_assignment_rules ADD CONSTRAINT request_auto_assignment_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_edit_approvals'::regclass AND conname='request_edit_approvals_request_id_fkey') THEN
    ALTER TABLE public.request_edit_approvals ADD CONSTRAINT request_edit_approvals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_edit_approvals'::regclass AND conname='request_edit_approvals_approval_id_fkey') THEN
    ALTER TABLE public.request_edit_approvals ADD CONSTRAINT request_edit_approvals_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.approvals(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.request_edit_approvals'::regclass AND conname='request_edit_approvals_requested_by_fkey') THEN
    ALTER TABLE public.request_edit_approvals ADD CONSTRAINT request_edit_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_antennas'::regclass AND conname='rfid_antennas_institute_id_fkey') THEN
    ALTER TABLE public.rfid_antennas ADD CONSTRAINT rfid_antennas_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_antennas'::regclass AND conname='rfid_antennas_reader_id_fkey') THEN
    ALTER TABLE public.rfid_antennas ADD CONSTRAINT rfid_antennas_reader_id_fkey FOREIGN KEY (reader_id) REFERENCES public.rfid_readers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_antennas'::regclass AND conname='rfid_antennas_location_id_fkey') THEN
    ALTER TABLE public.rfid_antennas ADD CONSTRAINT rfid_antennas_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_institute_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_asset_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_asset_tag_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_asset_tag_id_fkey FOREIGN KEY (asset_tag_id) REFERENCES public.asset_tags(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_portal_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.rfid_portals(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_reader_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_reader_id_fkey FOREIGN KEY (reader_id) REFERENCES public.rfid_readers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_from_location_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_to_location_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_business_events'::regclass AND conname='rfid_business_events_related_asset_movement_id_fkey') THEN
    ALTER TABLE public.rfid_business_events ADD CONSTRAINT rfid_business_events_related_asset_movement_id_fkey FOREIGN KEY (related_asset_movement_id) REFERENCES public.asset_movements(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_integration_clients'::regclass AND conname='rfid_integration_clients_institute_id_fkey') THEN
    ALTER TABLE public.rfid_integration_clients ADD CONSTRAINT rfid_integration_clients_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portal_antennas'::regclass AND conname='rfid_portal_antennas_portal_id_fkey') THEN
    ALTER TABLE public.rfid_portal_antennas ADD CONSTRAINT rfid_portal_antennas_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.rfid_portals(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portal_antennas'::regclass AND conname='rfid_portal_antennas_antenna_id_fkey') THEN
    ALTER TABLE public.rfid_portal_antennas ADD CONSTRAINT rfid_portal_antennas_antenna_id_fkey FOREIGN KEY (antenna_id) REFERENCES public.rfid_antennas(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portals'::regclass AND conname='rfid_portals_institute_id_fkey') THEN
    ALTER TABLE public.rfid_portals ADD CONSTRAINT rfid_portals_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portals'::regclass AND conname='rfid_portals_location_id_fkey') THEN
    ALTER TABLE public.rfid_portals ADD CONSTRAINT rfid_portals_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portals'::regclass AND conname='rfid_portals_from_location_id_fkey') THEN
    ALTER TABLE public.rfid_portals ADD CONSTRAINT rfid_portals_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_portals'::regclass AND conname='rfid_portals_to_location_id_fkey') THEN
    ALTER TABLE public.rfid_portals ADD CONSTRAINT rfid_portals_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_institute_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_integration_client_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_integration_client_id_fkey FOREIGN KEY (integration_client_id) REFERENCES public.rfid_integration_clients(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_asset_tag_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_asset_tag_id_fkey FOREIGN KEY (asset_tag_id) REFERENCES public.asset_tags(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_asset_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_reader_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_reader_id_fkey FOREIGN KEY (reader_id) REFERENCES public.rfid_readers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_antenna_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_antenna_id_fkey FOREIGN KEY (antenna_id) REFERENCES public.rfid_antennas(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_read_events'::regclass AND conname='rfid_read_events_portal_id_fkey') THEN
    ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.rfid_portals(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_readers'::regclass AND conname='rfid_readers_institute_id_fkey') THEN
    ALTER TABLE public.rfid_readers ADD CONSTRAINT rfid_readers_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfid_readers'::regclass AND conname='rfid_readers_location_id_fkey') THEN
    ALTER TABLE public.rfid_readers ADD CONSTRAINT rfid_readers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.asset_locations(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_response_items'::regclass AND conname='rfx_response_items_rfx_response_id_fkey') THEN
    ALTER TABLE public.rfx_response_items ADD CONSTRAINT rfx_response_items_rfx_response_id_fkey FOREIGN KEY (rfx_response_id) REFERENCES public.rfx_responses(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_response_items'::regclass AND conname='rfx_response_items_requested_item_id_fkey') THEN
    ALTER TABLE public.rfx_response_items ADD CONSTRAINT rfx_response_items_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_response_items'::regclass AND conname='rfx_response_items_approved_product_id_fkey') THEN
    ALTER TABLE public.rfx_response_items ADD CONSTRAINT rfx_response_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_response_items'::regclass AND conname='rfx_response_items_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.rfx_response_items ADD CONSTRAINT rfx_response_items_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.spare_part_equipment_compatibility'::regclass AND conname='spare_part_equipment_compatibility_spare_part_id_fkey') THEN
    ALTER TABLE public.spare_part_equipment_compatibility ADD CONSTRAINT spare_part_equipment_compatibility_spare_part_id_fkey FOREIGN KEY (spare_part_id) REFERENCES public.approved_spare_parts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.spare_part_equipment_compatibility'::regclass AND conname='spare_part_equipment_compatibility_equipment_id_fkey') THEN
    ALTER TABLE public.spare_part_equipment_compatibility ADD CONSTRAINT spare_part_equipment_compatibility_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.maintainable_equipment(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.spare_part_equipment_compatibility'::regclass AND conname='spare_part_equipment_compatibility_approved_by_fkey') THEN
    ALTER TABLE public.spare_part_equipment_compatibility ADD CONSTRAINT spare_part_equipment_compatibility_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.spare_part_equipment_compatibility'::regclass AND conname='spare_part_equipment_compatibility_created_by_fkey') THEN
    ALTER TABLE public.spare_part_equipment_compatibility ADD CONSTRAINT spare_part_equipment_compatibility_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_master_mappings'::regclass AND conname='stock_item_master_mappings_stock_item_id_fkey') THEN
    ALTER TABLE public.stock_item_master_mappings ADD CONSTRAINT stock_item_master_mappings_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_master_mappings'::regclass AND conname='stock_item_master_mappings_generic_item_id_fkey') THEN
    ALTER TABLE public.stock_item_master_mappings ADD CONSTRAINT stock_item_master_mappings_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_master_mappings'::regclass AND conname='stock_item_master_mappings_approved_product_id_fkey') THEN
    ALTER TABLE public.stock_item_master_mappings ADD CONSTRAINT stock_item_master_mappings_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_master_mappings'::regclass AND conname='stock_item_master_mappings_reviewed_by_fkey') THEN
    ALTER TABLE public.stock_item_master_mappings ADD CONSTRAINT stock_item_master_mappings_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_master_mappings'::regclass AND conname='stock_item_master_mappings_created_by_fkey') THEN
    ALTER TABLE public.stock_item_master_mappings ADD CONSTRAINT stock_item_master_mappings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_purchasing_uom_id_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_purchasing_uom_id_fkey FOREIGN KEY (purchasing_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_approved_product_id_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_contract_id_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_created_by_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_catalog_items'::regclass AND conname='supplier_catalog_items_updated_by_fkey') THEN
    ALTER TABLE public.supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_contacts'::regclass AND conname='supplier_contacts_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_contacts ADD CONSTRAINT supplier_contacts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_principals'::regclass AND conname='supplier_principals_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_principals ADD CONSTRAINT supplier_principals_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_principals'::regclass AND conname='supplier_principals_verified_by_fkey') THEN
    ALTER TABLE public.supplier_principals ADD CONSTRAINT supplier_principals_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_section_assignments'::regclass AND conname='user_section_assignments_user_id_fkey') THEN
    ALTER TABLE public.user_section_assignments ADD CONSTRAINT user_section_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_section_assignments'::regclass AND conname='user_section_assignments_section_id_fkey') THEN
    ALTER TABLE public.user_section_assignments ADD CONSTRAINT user_section_assignments_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_contract_id_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_rules'::regclass AND conname='approval_route_rules_approver_id_fkey') THEN
    ALTER TABLE public.approval_route_rules ADD CONSTRAINT approval_route_rules_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_journal_entry_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gl_postings'::regclass AND conname='gl_postings_journal_entry_id_fkey') THEN
    ALTER TABLE public.gl_postings ADD CONSTRAINT gl_postings_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_contract_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_category_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.item_categories(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_manufacturer_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.item_manufacturers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_institute_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_contract_id_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND conname='suppliers_institute_id_fkey') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_institute_id_fkey FOREIGN KEY (institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_payables'::regclass AND conname='ap_payables_request_id_fkey') THEN
    ALTER TABLE public.ap_payables ADD CONSTRAINT ap_payables_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_payables'::regclass AND conname='ap_payables_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.ap_payables ADD CONSTRAINT ap_payables_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_payables'::regclass AND conname='ap_payables_posted_by_fkey') THEN
    ALTER TABLE public.ap_payables ADD CONSTRAINT ap_payables_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_payables'::regclass AND conname='ap_payables_ap_voucher_id_fkey') THEN
    ALTER TABLE public.ap_payables ADD CONSTRAINT ap_payables_ap_voucher_id_fkey FOREIGN KEY (ap_voucher_id) REFERENCES public.ap_vouchers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_voucher_lines'::regclass AND conname='ap_voucher_lines_ap_voucher_id_fkey') THEN
    ALTER TABLE public.ap_voucher_lines ADD CONSTRAINT ap_voucher_lines_ap_voucher_id_fkey FOREIGN KEY (ap_voucher_id) REFERENCES public.ap_vouchers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_request_id_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_created_by_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_verified_by_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ap_vouchers'::regclass AND conname='ap_vouchers_posted_by_fkey') THEN
    ALTER TABLE public.ap_vouchers ADD CONSTRAINT ap_vouchers_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_rules'::regclass AND conname='approval_route_rules_warehouse_id_fkey') THEN
    ALTER TABLE public.approval_route_rules ADD CONSTRAINT approval_route_rules_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_route_rules'::regclass AND conname='approval_route_rules_version_id_fkey') THEN
    ALTER TABLE public.approval_route_rules ADD CONSTRAINT approval_route_rules_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.approval_route_versions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.audit_registry_entries'::regclass AND conname='audit_registry_entries_request_id_fkey') THEN
    ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.audit_registry_entries'::regclass AND conname='audit_registry_entries_requester_id_fkey') THEN
    ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.audit_registry_entries'::regclass AND conname='audit_registry_entries_created_by_fkey') THEN
    ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.audit_registry_entries'::regclass AND conname='audit_registry_entries_updated_by_fkey') THEN
    ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.budget_envelopes'::regclass AND conname='budget_envelopes_department_id_fkey') THEN
    ALTER TABLE public.budget_envelopes ADD CONSTRAINT budget_envelopes_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.budget_envelopes'::regclass AND conname='budget_envelopes_project_id_fkey') THEN
    ALTER TABLE public.budget_envelopes ADD CONSTRAINT budget_envelopes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.budget_envelopes'::regclass AND conname='budget_envelopes_created_by_fkey') THEN
    ALTER TABLE public.budget_envelopes ADD CONSTRAINT budget_envelopes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_request_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_budget_envelope_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_budget_envelope_id_fkey FOREIGN KEY (budget_envelope_id) REFERENCES public.budget_envelopes(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_actor_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_purchase_order_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_parent_commitment_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_parent_commitment_id_fkey FOREIGN KEY (parent_commitment_id) REFERENCES public.commitment_ledger(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.commitment_ledger'::regclass AND conname='commitment_ledger_ap_voucher_id_fkey') THEN
    ALTER TABLE public.commitment_ledger ADD CONSTRAINT commitment_ledger_ap_voucher_id_fkey FOREIGN KEY (ap_voucher_id) REFERENCES public.ap_vouchers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_evaluations'::regclass AND conname='contract_evaluations_contract_id_fkey') THEN
    ALTER TABLE public.contract_evaluations ADD CONSTRAINT contract_evaluations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_evaluations'::regclass AND conname='contract_evaluations_evaluator_id_fkey') THEN
    ALTER TABLE public.contract_evaluations ADD CONSTRAINT contract_evaluations_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_evaluations'::regclass AND conname='contract_evaluations_criterion_id_fkey') THEN
    ALTER TABLE public.contract_evaluations ADD CONSTRAINT contract_evaluations_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.custody_records'::regclass AND conname='custody_records_asset_id_fkey') THEN
    ALTER TABLE public.custody_records ADD CONSTRAINT custody_records_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.document_flow_links'::regclass AND conname='document_flow_links_request_id_fkey') THEN
    ALTER TABLE public.document_flow_links ADD CONSTRAINT document_flow_links_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.document_flow_links'::regclass AND conname='document_flow_links_created_by_fkey') THEN
    ALTER TABLE public.document_flow_links ADD CONSTRAINT document_flow_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_action_history'::regclass AND conname='finance_action_history_request_id_fkey') THEN
    ALTER TABLE public.finance_action_history ADD CONSTRAINT finance_action_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_action_history'::regclass AND conname='finance_action_history_actor_id_fkey') THEN
    ALTER TABLE public.finance_action_history ADD CONSTRAINT finance_action_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_cost_centers'::regclass AND conname='finance_cost_centers_department_id_fkey') THEN
    ALTER TABLE public.finance_cost_centers ADD CONSTRAINT finance_cost_centers_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_cost_centers'::regclass AND conname='finance_cost_centers_project_id_fkey') THEN
    ALTER TABLE public.finance_cost_centers ADD CONSTRAINT finance_cost_centers_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_postings'::regclass AND conname='finance_postings_request_id_fkey') THEN
    ALTER TABLE public.finance_postings ADD CONSTRAINT finance_postings_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_postings'::regclass AND conname='finance_postings_ap_voucher_id_fkey') THEN
    ALTER TABLE public.finance_postings ADD CONSTRAINT finance_postings_ap_voucher_id_fkey FOREIGN KEY (ap_voucher_id) REFERENCES public.ap_vouchers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_postings'::regclass AND conname='finance_postings_posted_by_fkey') THEN
    ALTER TABLE public.finance_postings ADD CONSTRAINT finance_postings_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_postings'::regclass AND conname='finance_postings_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.finance_postings ADD CONSTRAINT finance_postings_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gl_posting_lines'::regclass AND conname='gl_posting_lines_gl_posting_id_fkey') THEN
    ALTER TABLE public.gl_posting_lines ADD CONSTRAINT gl_posting_lines_gl_posting_id_fkey FOREIGN KEY (gl_posting_id) REFERENCES public.gl_postings(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gl_posting_lines'::regclass AND conname='gl_posting_lines_cost_center_id_fkey') THEN
    ALTER TABLE public.gl_posting_lines ADD CONSTRAINT gl_posting_lines_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.finance_cost_centers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gl_postings'::regclass AND conname='gl_postings_request_id_fkey') THEN
    ALTER TABLE public.gl_postings ADD CONSTRAINT gl_postings_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gl_postings'::regclass AND conname='gl_postings_posted_by_fkey') THEN
    ALTER TABLE public.gl_postings ADD CONSTRAINT gl_postings_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_goods_receipt_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_goods_receipt_id_fkey FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_requested_item_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_purchase_order_item_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_warehouse_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_stock_item_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_generic_item_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_approved_product_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='goods_receipt_items_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipts'::regclass AND conname='goods_receipts_request_id_fkey') THEN
    ALTER TABLE public.goods_receipts ADD CONSTRAINT goods_receipts_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipts'::regclass AND conname='goods_receipts_received_by_fkey') THEN
    ALTER TABLE public.goods_receipts ADD CONSTRAINT goods_receipts_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipts'::regclass AND conname='goods_receipts_purchase_order_id_fkey') THEN
    ALTER TABLE public.goods_receipts ADD CONSTRAINT goods_receipts_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_generic_item_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_approved_product_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_transactions'::regclass AND conname='inventory_transactions_supplier_id_fkey') THEN
    ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_items'::regclass AND conname='invoice_items_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_items'::regclass AND conname='invoice_items_requested_item_id_fkey') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_items'::regclass AND conname='invoice_items_purchase_order_item_id_fkey') THEN
    ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_results'::regclass AND conname='invoice_match_results_request_id_fkey') THEN
    ALTER TABLE public.invoice_match_results ADD CONSTRAINT invoice_match_results_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_results'::regclass AND conname='invoice_match_results_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.invoice_match_results ADD CONSTRAINT invoice_match_results_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_results'::regclass AND conname='invoice_match_results_matched_by_fkey') THEN
    ALTER TABLE public.invoice_match_results ADD CONSTRAINT invoice_match_results_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.invoice_match_results'::regclass AND conname='invoice_match_results_override_by_fkey') THEN
    ALTER TABLE public.invoice_match_results ADD CONSTRAINT invoice_match_results_override_by_fkey FOREIGN KEY (override_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_brands'::regclass AND conname='item_brands_manufacturer_id_fkey') THEN
    ALTER TABLE public.item_brands ADD CONSTRAINT item_brands_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.item_manufacturers(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_categories'::regclass AND conname='item_categories_created_by_fkey') THEN
    ALTER TABLE public.item_categories ADD CONSTRAINT item_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_categories'::regclass AND conname='item_categories_updated_by_fkey') THEN
    ALTER TABLE public.item_categories ADD CONSTRAINT item_categories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_conversion'::regclass AND conname='item_conversion_item_master_id_fkey') THEN
    ALTER TABLE public.item_conversion ADD CONSTRAINT item_conversion_item_master_id_fkey FOREIGN KEY (item_master_id) REFERENCES public.item_master(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_conversion'::regclass AND conname='item_conversion_from_uom_id_fkey') THEN
    ALTER TABLE public.item_conversion ADD CONSTRAINT item_conversion_from_uom_id_fkey FOREIGN KEY (from_uom_id) REFERENCES public.item_uom(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_conversion'::regclass AND conname='item_conversion_to_uom_id_fkey') THEN
    ALTER TABLE public.item_conversion ADD CONSTRAINT item_conversion_to_uom_id_fkey FOREIGN KEY (to_uom_id) REFERENCES public.item_uom(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_manufacturers'::regclass AND conname='item_manufacturers_created_by_fkey') THEN
    ALTER TABLE public.item_manufacturers ADD CONSTRAINT item_manufacturers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_manufacturers'::regclass AND conname='item_manufacturers_updated_by_fkey') THEN
    ALTER TABLE public.item_manufacturers ADD CONSTRAINT item_manufacturers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_category_id_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.item_categories(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_base_uom_id_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.item_uom(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_manufacturer_id_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.item_manufacturers(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_brand_id_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.item_brands(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_created_by_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master'::regclass AND conname='item_master_updated_by_fkey') THEN
    ALTER TABLE public.item_master ADD CONSTRAINT item_master_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_documents'::regclass AND conname='item_master_documents_item_id_fkey') THEN
    ALTER TABLE public.item_master_documents ADD CONSTRAINT item_master_documents_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.item_master_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_documents'::regclass AND conname='item_master_documents_uploaded_by_fkey') THEN
    ALTER TABLE public.item_master_documents ADD CONSTRAINT item_master_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_items'::regclass AND conname='item_master_items_submitted_by_fkey') THEN
    ALTER TABLE public.item_master_items ADD CONSTRAINT item_master_items_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_items'::regclass AND conname='item_master_items_approved_by_fkey') THEN
    ALTER TABLE public.item_master_items ADD CONSTRAINT item_master_items_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_items'::regclass AND conname='item_master_items_created_by_fkey') THEN
    ALTER TABLE public.item_master_items ADD CONSTRAINT item_master_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_master_items'::regclass AND conname='item_master_items_updated_by_fkey') THEN
    ALTER TABLE public.item_master_items ADD CONSTRAINT item_master_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_recalls'::regclass AND conname='item_recalls_item_id_fkey') THEN
    ALTER TABLE public.item_recalls ADD CONSTRAINT item_recalls_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stock_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_recalls'::regclass AND conname='item_recalls_department_id_fkey') THEN
    ALTER TABLE public.item_recalls ADD CONSTRAINT item_recalls_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_recalls'::regclass AND conname='item_recalls_initiated_by_user_id_fkey') THEN
    ALTER TABLE public.item_recalls ADD CONSTRAINT item_recalls_initiated_by_user_id_fkey FOREIGN KEY (initiated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_recalls'::regclass AND conname='item_recalls_escalated_by_user_id_fkey') THEN
    ALTER TABLE public.item_recalls ADD CONSTRAINT item_recalls_escalated_by_user_id_fkey FOREIGN KEY (escalated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_uom'::regclass AND conname='item_uom_created_by_fkey') THEN
    ALTER TABLE public.item_uom ADD CONSTRAINT item_uom_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_uom'::regclass AND conname='item_uom_updated_by_fkey') THEN
    ALTER TABLE public.item_uom ADD CONSTRAINT item_uom_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.item_variants'::regclass AND conname='item_variants_item_master_id_fkey') THEN
    ALTER TABLE public.item_variants ADD CONSTRAINT item_variants_item_master_id_fkey FOREIGN KEY (item_master_id) REFERENCES public.item_master(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.monthly_dispensing'::regclass AND conname='monthly_dispensing_created_by_fkey') THEN
    ALTER TABLE public.monthly_dispensing ADD CONSTRAINT monthly_dispensing_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.non_po_receipt_approvals'::regclass AND conname='non_po_receipt_approvals_goods_receipt_id_fkey') THEN
    ALTER TABLE public.non_po_receipt_approvals ADD CONSTRAINT non_po_receipt_approvals_goods_receipt_id_fkey FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.non_po_receipt_approvals'::regclass AND conname='non_po_receipt_approvals_request_id_fkey') THEN
    ALTER TABLE public.non_po_receipt_approvals ADD CONSTRAINT non_po_receipt_approvals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.non_po_receipt_approvals'::regclass AND conname='non_po_receipt_approvals_approved_by_fkey') THEN
    ALTER TABLE public.non_po_receipt_approvals ADD CONSTRAINT non_po_receipt_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notifications_outbox_event_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_outbox_event_id_fkey FOREIGN KEY (outbox_event_id) REFERENCES public.notification_outbox(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_allocations'::regclass AND conname='payment_allocations_payment_record_id_fkey') THEN
    ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_payment_record_id_fkey FOREIGN KEY (payment_record_id) REFERENCES public.payment_records(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_allocations'::regclass AND conname='payment_allocations_ap_payable_id_fkey') THEN
    ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_ap_payable_id_fkey FOREIGN KEY (ap_payable_id) REFERENCES public.ap_payables(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_records'::regclass AND conname='payment_records_request_id_fkey') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_records'::regclass AND conname='payment_records_ap_voucher_id_fkey') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_ap_voucher_id_fkey FOREIGN KEY (ap_voucher_id) REFERENCES public.ap_vouchers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_records'::regclass AND conname='payment_records_paid_by_fkey') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_records'::regclass AND conname='payment_records_supplier_invoice_id_fkey') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_records'::regclass AND conname='payment_records_reversal_of_payment_id_fkey') THEN
    ALTER TABLE public.payment_records ADD CONSTRAINT payment_records_reversal_of_payment_id_fkey FOREIGN KEY (reversal_of_payment_id) REFERENCES public.payment_records(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_lifecycle_states'::regclass AND conname='procurement_lifecycle_states_request_id_fkey') THEN
    ALTER TABLE public.procurement_lifecycle_states ADD CONSTRAINT procurement_lifecycle_states_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_lifecycle_states'::regclass AND conname='procurement_lifecycle_states_created_by_fkey') THEN
    ALTER TABLE public.procurement_lifecycle_states ADD CONSTRAINT procurement_lifecycle_states_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_consumptions'::regclass AND conname='procurement_plan_item_consumptions_plan_item_id_fkey') THEN
    ALTER TABLE public.procurement_plan_item_consumptions ADD CONSTRAINT procurement_plan_item_consumptions_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES public.procurement_plan_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_consumptions'::regclass AND conname='procurement_plan_item_consumptions_warehouse_stock_movement_id_') THEN
    ALTER TABLE public.procurement_plan_item_consumptions ADD CONSTRAINT procurement_plan_item_consumptions_warehouse_stock_movement_id_ FOREIGN KEY (warehouse_stock_movement_id) REFERENCES public.warehouse_stock_movements(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_consumptions'::regclass AND conname='procurement_plan_item_consumptions_department_stock_movement_id') THEN
    ALTER TABLE public.procurement_plan_item_consumptions ADD CONSTRAINT procurement_plan_item_consumptions_department_stock_movement_id FOREIGN KEY (department_stock_movement_id) REFERENCES public.department_stock_movements(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_requests'::regclass AND conname='procurement_plan_item_requests_plan_item_id_fkey') THEN
    ALTER TABLE public.procurement_plan_item_requests ADD CONSTRAINT procurement_plan_item_requests_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES public.procurement_plan_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_requests'::regclass AND conname='procurement_plan_item_requests_request_id_fkey') THEN
    ALTER TABLE public.procurement_plan_item_requests ADD CONSTRAINT procurement_plan_item_requests_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_item_requests'::regclass AND conname='procurement_plan_item_requests_requested_item_id_fkey') THEN
    ALTER TABLE public.procurement_plan_item_requests ADD CONSTRAINT procurement_plan_item_requests_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_items'::regclass AND conname='procurement_plan_items_plan_id_fkey') THEN
    ALTER TABLE public.procurement_plan_items ADD CONSTRAINT procurement_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.procurement_plans(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_plan_items'::regclass AND conname='procurement_plan_items_stock_item_id_fkey') THEN
    ALTER TABLE public.procurement_plan_items ADD CONSTRAINT procurement_plan_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_state_history'::regclass AND conname='procurement_state_history_request_id_fkey') THEN
    ALTER TABLE public.procurement_state_history ADD CONSTRAINT procurement_state_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_state_history'::regclass AND conname='procurement_state_history_changed_by_fkey') THEN
    ALTER TABLE public.procurement_state_history ADD CONSTRAINT procurement_state_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.projects'::regclass AND conname='projects_created_by_fkey') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_purchase_order_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_requested_item_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_request_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_request_item_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_request_item_id_fkey FOREIGN KEY (request_item_id) REFERENCES public.requested_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_award_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_award_id_fkey FOREIGN KEY (award_id) REFERENCES public.procurement_awards(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_approved_product_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_supplier_catalog_item_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_supplier_catalog_item_id_fkey FOREIGN KEY (supplier_catalog_item_id) REFERENCES public.supplier_catalog_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_source_uom_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_source_uom_id_fkey FOREIGN KEY (source_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_base_uom_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_items'::regclass AND conname='purchase_order_items_generic_item_id_fkey') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_request_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_rfx_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_rfx_id_fkey FOREIGN KEY (rfx_id) REFERENCES public.rfx_events(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_rfx_response_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_rfx_response_id_fkey FOREIGN KEY (rfx_response_id) REFERENCES public.rfx_responses(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_supplier_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_created_by_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_issued_by_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_orders'::regclass AND conname='purchase_orders_approved_by_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_assigned_to_fkey') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_assigned_by_fkey') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_generic_item_id_fkey') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_preferred_product_id_fkey') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_preferred_product_id_fkey FOREIGN KEY (preferred_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requested_items'::regclass AND conname='requested_items_mandatory_product_id_fkey') THEN
    ALTER TABLE public.requested_items ADD CONSTRAINT requested_items_mandatory_product_id_fkey FOREIGN KEY (mandatory_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requests'::regclass AND conname='requests_awarded_supplier_id_fkey') THEN
    ALTER TABLE public.requests ADD CONSTRAINT requests_awarded_supplier_id_fkey FOREIGN KEY (awarded_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requests'::regclass AND conname='requests_awarded_rfx_id_fkey') THEN
    ALTER TABLE public.requests ADD CONSTRAINT requests_awarded_rfx_id_fkey FOREIGN KEY (awarded_rfx_id) REFERENCES public.rfx_events(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requests'::regclass AND conname='requests_awarded_rfx_response_id_fkey') THEN
    ALTER TABLE public.requests ADD CONSTRAINT requests_awarded_rfx_response_id_fkey FOREIGN KEY (awarded_rfx_response_id) REFERENCES public.rfx_responses(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.requests'::regclass AND conname='requests_purchase_order_id_fkey') THEN
    ALTER TABLE public.requests ADD CONSTRAINT requests_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_events'::regclass AND conname='rfx_events_request_id_fkey') THEN
    ALTER TABLE public.rfx_events ADD CONSTRAINT rfx_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_events'::regclass AND conname='rfx_events_created_by_fkey') THEN
    ALTER TABLE public.rfx_events ADD CONSTRAINT rfx_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_responses'::regclass AND conname='rfx_responses_rfx_id_fkey') THEN
    ALTER TABLE public.rfx_responses ADD CONSTRAINT rfx_responses_rfx_id_fkey FOREIGN KEY (rfx_id) REFERENCES public.rfx_events(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_responses'::regclass AND conname='rfx_responses_request_id_fkey') THEN
    ALTER TABLE public.rfx_responses ADD CONSTRAINT rfx_responses_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_responses'::regclass AND conname='rfx_responses_supplier_id_fkey') THEN
    ALTER TABLE public.rfx_responses ADD CONSTRAINT rfx_responses_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.rfx_responses'::regclass AND conname='rfx_responses_submitted_by_fkey') THEN
    ALTER TABLE public.rfx_responses ADD CONSTRAINT rfx_responses_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.risk_register'::regclass AND conname='risk_register_created_by_user_id_fkey') THEN
    ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.risk_register'::regclass AND conname='risk_register_updated_by_user_id_fkey') THEN
    ALTER TABLE public.risk_register ADD CONSTRAINT risk_register_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_data_scopes'::regclass AND conname='role_data_scopes_role_id_fkey') THEN
    ALTER TABLE public.role_data_scopes ADD CONSTRAINT role_data_scopes_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_data_scopes'::regclass AND conname='role_data_scopes_data_scope_id_fkey') THEN
    ALTER TABLE public.role_data_scopes ADD CONSTRAINT role_data_scopes_data_scope_id_fkey FOREIGN KEY (data_scope_id) REFERENCES public.data_scopes(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_permissions'::regclass AND conname='role_permissions_role_id_fkey') THEN
    ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_permissions'::regclass AND conname='role_permissions_permission_id_fkey') THEN
    ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_requests'::regclass AND conname='stock_item_requests_requested_by_fkey') THEN
    ALTER TABLE public.stock_item_requests ADD CONSTRAINT stock_item_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_item_requests'::regclass AND conname='stock_item_requests_approved_by_fkey') THEN
    ALTER TABLE public.stock_item_requests ADD CONSTRAINT stock_item_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_item_master_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_item_master_id_fkey FOREIGN KEY (item_master_id) REFERENCES public.item_master(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_item_variant_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_item_variant_id_fkey FOREIGN KEY (item_variant_id) REFERENCES public.item_variants(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_generic_item_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_approved_product_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_approved_product_id_fkey FOREIGN KEY (approved_product_id) REFERENCES public.approved_products(id) ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_inventory_uom_id_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_inventory_uom_id_fkey FOREIGN KEY (inventory_uom_id) REFERENCES public.item_uom(id) ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_items'::regclass AND conname='stock_items_mapped_by_fkey') THEN
    ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_mapped_by_fkey FOREIGN KEY (mapped_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_compliance_artifacts'::regclass AND conname='supplier_compliance_artifacts_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_compliance_artifacts ADD CONSTRAINT supplier_compliance_artifacts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='supplier_evaluations_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT supplier_evaluations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_evaluations'::regclass AND conname='supplier_evaluations_evaluator_id_fkey') THEN
    ALTER TABLE public.supplier_evaluations ADD CONSTRAINT supplier_evaluations_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_request_id_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_receipt_id_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.goods_receipts(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_submitted_by_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_purchase_order_id_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_issues'::regclass AND conname='supplier_issues_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_issues ADD CONSTRAINT supplier_issues_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_issues'::regclass AND conname='supplier_issues_contract_id_fkey') THEN
    ALTER TABLE public.supplier_issues ADD CONSTRAINT supplier_issues_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_scorecards'::regclass AND conname='supplier_scorecards_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_scorecards ADD CONSTRAINT supplier_scorecards_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_scorecards'::regclass AND conname='supplier_scorecards_contract_id_fkey') THEN
    ALTER TABLE public.supplier_scorecards ADD CONSTRAINT supplier_scorecards_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technical_inspections'::regclass AND conname='technical_inspections_created_by_fkey') THEN
    ALTER TABLE public.technical_inspections ADD CONSTRAINT technical_inspections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technical_inspections'::regclass AND conname='technical_inspections_request_id_fkey') THEN
    ALTER TABLE public.technical_inspections ADD CONSTRAINT technical_inspections_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technical_inspections'::regclass AND conname='technical_inspections_requested_item_id_fkey') THEN
    ALTER TABLE public.technical_inspections ADD CONSTRAINT technical_inspections_requested_item_id_fkey FOREIGN KEY (requested_item_id) REFERENCES public.requested_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technical_inspections'::regclass AND conname='technical_inspections_acceptance_recorded_by_fkey') THEN
    ALTER TABLE public.technical_inspections ADD CONSTRAINT technical_inspections_acceptance_recorded_by_fkey FOREIGN KEY (acceptance_recorded_by) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_data_scopes'::regclass AND conname='user_data_scopes_user_id_fkey') THEN
    ALTER TABLE public.user_data_scopes ADD CONSTRAINT user_data_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_data_scopes'::regclass AND conname='user_data_scopes_data_scope_id_fkey') THEN
    ALTER TABLE public.user_data_scopes ADD CONSTRAINT user_data_scopes_data_scope_id_fkey FOREIGN KEY (data_scope_id) REFERENCES public.data_scopes(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_permissions'::regclass AND conname='user_permissions_user_id_fkey') THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_permissions'::regclass AND conname='user_permissions_permission_id_fkey') THEN
    ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_stock_levels'::regclass AND conname='warehouse_stock_levels_generic_item_id_fkey') THEN
    ALTER TABLE public.warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_generic_item_id_fkey FOREIGN KEY (generic_item_id) REFERENCES public.generic_items(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supplied_items'::regclass AND conname='warehouse_supplied_items_request_id_fkey') THEN
    ALTER TABLE public.warehouse_supplied_items ADD CONSTRAINT warehouse_supplied_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supplied_items'::regclass AND conname='warehouse_supplied_items_item_id_fkey') THEN
    ALTER TABLE public.warehouse_supplied_items ADD CONSTRAINT warehouse_supplied_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.warehouse_supply_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supplied_items'::regclass AND conname='warehouse_supplied_items_supplied_by_fkey') THEN
    ALTER TABLE public.warehouse_supplied_items ADD CONSTRAINT warehouse_supplied_items_supplied_by_fkey FOREIGN KEY (supplied_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supply_items'::regclass AND conname='warehouse_supply_items_request_id_fkey') THEN
    ALTER TABLE public.warehouse_supply_items ADD CONSTRAINT warehouse_supply_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_supply_templates'::regclass AND conname='warehouse_supply_templates_department_id_fkey') THEN
    ALTER TABLE public.warehouse_supply_templates ADD CONSTRAINT warehouse_supply_templates_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_items'::regclass AND conname='warehouse_transfer_items_transfer_id_fkey') THEN
    ALTER TABLE public.warehouse_transfer_items ADD CONSTRAINT warehouse_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.warehouse_transfer_requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_items'::regclass AND conname='warehouse_transfer_items_stock_item_id_fkey') THEN
    ALTER TABLE public.warehouse_transfer_items ADD CONSTRAINT warehouse_transfer_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_origin_warehouse_id_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_origin_warehouse_id_fkey FOREIGN KEY (origin_warehouse_id) REFERENCES public.warehouses(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_destination_warehouse_id_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_destination_warehouse_id_fkey FOREIGN KEY (destination_warehouse_id) REFERENCES public.warehouses(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_requested_by_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_approved_by_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_rejected_by_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id) NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouse_transfer_requests'::regclass AND conname='warehouse_transfer_requests_dispatched_by_fkey') THEN
    ALTER TABLE public.warehouse_transfer_requests ADD CONSTRAINT warehouse_transfer_requests_dispatched_by_fkey FOREIGN KEY (dispatched_by) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $fk$;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.warehouses'::regclass AND conname='warehouses_department_id_fkey') THEN
    ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $fk$;
-- Function source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.approval_route_snapshot_guard()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION approval_route_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'APPROVAL_ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000'; END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.approval_route_snapshot_validate()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION approval_route_snapshot_validate() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE prior approval_route_snapshots%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM requests WHERE id=NEW.request_id AND institute_id=NEW.institute_id) THEN RAISE EXCEPTION 'SNAPSHOT_REQUEST_INSTITUTE_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM approval_policy_versions v JOIN approval_policies p ON p.id=v.approval_policy_id WHERE v.id=NEW.policy_version_id AND p.id=NEW.policy_id AND p.institute_id=NEW.institute_id) THEN RAISE EXCEPTION 'SNAPSHOT_POLICY_INSTITUTE_MISMATCH'; END IF;
 IF NEW.generation_number=1 AND NEW.supersedes_snapshot_id IS NOT NULL THEN RAISE EXCEPTION 'SNAPSHOT_FIRST_GENERATION_CANNOT_SUPERSEDE'; END IF;
 IF NEW.generation_number>1 THEN
   IF NEW.supersedes_snapshot_id IS NULL THEN RAISE EXCEPTION 'SNAPSHOT_SUPERSEDES_REQUIRED'; END IF;
   SELECT * INTO prior FROM approval_route_snapshots WHERE id=NEW.supersedes_snapshot_id;
   IF NOT FOUND OR prior.request_id<>NEW.request_id OR prior.institute_id<>NEW.institute_id OR prior.generation_number<>NEW.generation_number-1 THEN RAISE EXCEPTION 'SNAPSHOT_SUPERSEDES_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.enforce_rfid_antenna_scope_update()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION public.enforce_rfid_antenna_scope_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE reader_institute integer; portal_institute integer;
    BEGIN

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||NEW.id::text,0));
      SELECT institute_id INTO reader_institute FROM public.rfid_readers WHERE id=NEW.reader_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID reader % for antenna % does not exist',NEW.reader_id,NEW.id; END IF;
      IF reader_institute<>NEW.institute_id THEN
        RAISE EXCEPTION 'RFID antenna and reader must belong to the same institute';
      END IF;
      FOR portal_institute IN
        SELECT p.institute_id FROM public.rfid_portal_antennas pa
        JOIN public.rfid_portals p ON p.id=pa.portal_id
        WHERE pa.antenna_id=OLD.id ORDER BY p.id FOR SHARE OF p
      LOOP
        IF portal_institute<>NEW.institute_id THEN
          RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute';
        END IF;
      END LOOP;
      RETURN NEW;
    END $body$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.enforce_rfid_portal_antenna_scope()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION public.enforce_rfid_portal_antenna_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE p public.rfid_portals%ROWTYPE; a public.rfid_antennas%ROWTYPE; reader_institute integer;
    BEGIN

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||NEW.antenna_id::text,0));
      SELECT * INTO p FROM public.rfid_portals WHERE id=NEW.portal_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID portal % does not exist',NEW.portal_id; END IF;
      SELECT * INTO a FROM public.rfid_antennas WHERE id=NEW.antenna_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID antenna % does not exist',NEW.antenna_id; END IF;
      SELECT institute_id INTO reader_institute FROM public.rfid_readers WHERE id=a.reader_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID reader % for antenna % does not exist',a.reader_id,a.id; END IF;
      IF p.institute_id<>a.institute_id THEN RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute'; END IF;
      IF reader_institute<>a.institute_id THEN RAISE EXCEPTION 'RFID antenna and reader must belong to the same institute'; END IF;
      IF p.enabled AND EXISTS (
        SELECT 1 FROM public.rfid_portal_antennas pa JOIN public.rfid_portals other ON other.id=pa.portal_id
        WHERE pa.antenna_id=NEW.antenna_id AND other.enabled AND pa.portal_id<>NEW.portal_id
      ) THEN RAISE EXCEPTION 'RFID antenna % is already mapped to another enabled portal',NEW.antenna_id; END IF;
      RETURN NEW;
    END $body$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.enforce_rfid_portal_enable_scope()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION public.enforce_rfid_portal_enable_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE mapping record;
    BEGIN

      IF NEW.institute_id IS DISTINCT FROM OLD.institute_id
         AND EXISTS (SELECT 1 FROM public.rfid_portal_antennas WHERE portal_id=OLD.id) THEN
        RAISE EXCEPTION 'Cannot change institute of a configured RFID portal';
      END IF;
      IF NEW.enabled THEN
        FOR mapping IN
          SELECT pa.antenna_id,NULL::integer AS antenna_institute,NULL::integer AS reader_institute
          FROM public.rfid_portal_antennas pa
          WHERE pa.portal_id=OLD.id ORDER BY pa.antenna_id
        LOOP
          PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||mapping.antenna_id::text,0));
          SELECT a.institute_id,r.institute_id INTO mapping.antenna_institute,mapping.reader_institute
          FROM public.rfid_antennas a JOIN public.rfid_readers r ON r.id=a.reader_id
          WHERE a.id=mapping.antenna_id FOR SHARE OF a,r;
          IF mapping.antenna_institute IS NULL THEN RAISE EXCEPTION 'Mapped RFID antenna % does not exist',mapping.antenna_id; END IF;
          IF mapping.antenna_institute<>NEW.institute_id THEN RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute'; END IF;
          IF mapping.reader_institute IS NULL OR mapping.reader_institute<>NEW.institute_id THEN
            RAISE EXCEPTION 'RFID antenna reader must belong to the same institute';
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.rfid_portal_antennas pa JOIN public.rfid_portals other ON other.id=pa.portal_id
            WHERE pa.antenna_id=mapping.antenna_id AND pa.portal_id<>OLD.id AND other.enabled
          ) THEN RAISE EXCEPTION 'RFID antenna % is already mapped to another enabled portal',mapping.antenna_id; END IF;
        END LOOP;
      END IF;
      RETURN NEW;
    END $body$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.enforce_rfid_reader_scope_update()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION public.enforce_rfid_reader_scope_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE mapped_antenna record; current_antenna_institute integer;
    BEGIN

      FOR mapped_antenna IN
        SELECT a.id FROM public.rfid_antennas a
        WHERE a.reader_id=OLD.id ORDER BY a.id
      LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||mapped_antenna.id::text,0));
        SELECT a.institute_id INTO current_antenna_institute FROM public.rfid_antennas a
        WHERE a.id=mapped_antenna.id AND a.reader_id=OLD.id
          AND EXISTS (SELECT 1 FROM public.rfid_portal_antennas pa WHERE pa.antenna_id=a.id);
        IF FOUND AND current_antenna_institute<>NEW.institute_id THEN
          RAISE EXCEPTION 'Cannot change institute of an RFID reader with mapped antennas';
        END IF;
      END LOOP;
      RETURN NEW;
    END $body$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/030_fixed_asset_physical_inventory.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.next_asset_inventory_number(integer)') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION next_asset_inventory_number(p_institute_id integer) RETURNS text LANGUAGE plpgsql AS $fn$ DECLARE n bigint;p text; BEGIN INSERT INTO asset_inventory_number_allocators(institute_id,next_value) VALUES(p_institute_id,2) ON CONFLICT(institute_id) DO UPDATE SET next_value=asset_inventory_number_allocators.next_value+1 RETURNING next_value-1,prefix INTO n,p; RETURN p||'-'||extract(year from current_date)::integer||'-'||lpad(n::text,6,'0'); END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/017_fixed_assets_rfid_core.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.next_asset_number(integer)') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION next_asset_number(p_institute_id integer) RETURNS text LANGUAGE plpgsql AS $fn$ DECLARE n bigint;p text; BEGIN INSERT INTO asset_number_allocators(institute_id,next_value) VALUES(p_institute_id,2) ON CONFLICT(institute_id) DO UPDATE SET next_value=asset_number_allocators.next_value+1 RETURNING next_value-1,prefix INTO n,p;RETURN p||'-'||lpad(n::text,6,'0');END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/024_maintenance_work_orders.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.next_maintenance_work_order_number(integer)') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION public.next_maintenance_work_order_number(p_institute_id integer) RETURNS text
  LANGUAGE plpgsql AS $fn$ DECLARE n bigint; BEGIN
    INSERT INTO public.maintenance_work_order_allocators(institute_id,next_value) VALUES(p_institute_id,2)
    ON CONFLICT(institute_id) DO UPDATE SET next_value=maintenance_work_order_allocators.next_value+1
    RETURNING next_value-1 INTO n;
    RETURN 'MWO-'||p_institute_id||'-'||lpad(n::text,6,'0');
  END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/004_inventory_transaction_engine.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.prevent_inventory_allocation_mutation()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION prevent_inventory_allocation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory transaction allocations are immutable; post a reversal';
END $$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/030_fixed_asset_physical_inventory.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.prevent_inventory_snapshot_mutation()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION prevent_inventory_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'INVENTORY_EXPECTED_SNAPSHOT_IMMUTABLE'; END $fn$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/004_inventory_transaction_engine.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.prevent_posted_inventory_mutation()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION prevent_posted_inventory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.idempotency_key IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Posted inventory transactions are immutable; post a reversal';
  END IF;
  IF (to_jsonb(NEW) - 'reversed_by_movement_id') IS DISTINCT FROM
     (to_jsonb(OLD) - 'reversed_by_movement_id') OR
     NEW.reversed_by_movement_id IS NOT DISTINCT FROM OLD.reversed_by_movement_id THEN
    RAISE EXCEPTION 'Posted inventory transactions are immutable; only the reversal link may be set';
  END IF;
  IF OLD.reversed_by_movement_id IS NOT NULL OR NEW.reversed_by_movement_id IS NULL THEN
    RAISE EXCEPTION 'Inventory reversal links cannot be cleared or replaced';
  END IF;
  RETURN NEW;
END $$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/014_organization_hierarchy.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.validate_organization_position_user()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION validate_organization_position_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_institute INTEGER; user_institute INTEGER;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT institute_id INTO unit_institute FROM organization_units WHERE id=NEW.organization_unit_id;
  SELECT institute_id INTO user_institute FROM users WHERE id=NEW.user_id;
  IF user_institute IS DISTINCT FROM unit_institute THEN RAISE EXCEPTION 'position holder must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/manual/014_organization_hierarchy.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.validate_organization_unit()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION validate_organization_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_institute INTEGER; linked_institute INTEGER;
BEGIN
  IF NEW.parent_unit_id IS NOT NULL THEN
    SELECT institute_id INTO parent_institute FROM organization_units WHERE id=NEW.parent_unit_id FOR KEY SHARE;
    IF parent_institute IS NULL THEN RAISE EXCEPTION 'parent organization unit not found' USING ERRCODE='23503'; END IF;
    IF parent_institute <> NEW.institute_id THEN RAISE EXCEPTION 'organization units cannot cross institute boundaries' USING ERRCODE='23514'; END IF;
    IF NEW.parent_unit_id=NEW.id OR EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM organization_units WHERE parent_unit_id=NEW.id
        UNION ALL SELECT u.id FROM organization_units u JOIN descendants d ON u.parent_unit_id=d.id
      ) SELECT 1 FROM descendants WHERE id=NEW.parent_unit_id
    ) THEN RAISE EXCEPTION 'organization hierarchy cycle detected' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT institute_id INTO linked_institute FROM departments WHERE id=NEW.department_id;
    IF linked_institute IS DISTINCT FROM NEW.institute_id THEN RAISE EXCEPTION 'department must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.section_id IS NOT NULL THEN
    SELECT d.institute_id INTO linked_institute FROM sections s JOIN departments d ON d.id=s.department_id WHERE s.id=NEW.section_id;
    IF linked_institute IS DISTINCT FROM NEW.institute_id THEN RAISE EXCEPTION 'section must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;$function_body$;
  END IF;
END $function_install$;
-- Function source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
DO $function_install$ BEGIN
  IF to_regprocedure('public.validate_stock_mapping_target()') IS NULL THEN
    EXECUTE $function_body$CREATE FUNCTION validate_stock_mapping_target() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p RECORD; g RECORD; BEGIN
 IF NEW.generic_item_id IS NULL AND NEW.mapping_status='approved' THEN RAISE EXCEPTION 'approved mapping requires generic item'; END IF;
 IF NEW.mapping_status='approved' AND NEW.generic_item_id IS NOT NULL THEN SELECT lifecycle_status,is_active INTO g FROM generic_items WHERE id=NEW.generic_item_id; IF NOT FOUND OR g.lifecycle_status<>'active' OR NOT g.is_active THEN RAISE EXCEPTION 'generic item must be active for approval'; END IF; END IF;
 IF NEW.approved_product_id IS NOT NULL THEN SELECT generic_item_id,approval_status,is_active INTO p FROM approved_products WHERE id=NEW.approved_product_id; IF NOT FOUND OR p.generic_item_id<>NEW.generic_item_id THEN RAISE EXCEPTION 'product belongs to another generic item'; END IF; IF NEW.mapping_status='approved' AND (p.approval_status<>'approved' OR NOT p.is_active) THEN RAISE EXCEPTION 'product must be active and approved for approval'; END IF; END IF; RETURN NEW; END $$;$function_body$;
  END IF;
END $function_install$;
-- Trigger source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.approval_route_snapshot_steps'::regclass AND tgname='approval_route_snapshot_steps_immutable_trg' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER approval_route_snapshot_steps_immutable_trg BEFORE UPDATE OR DELETE ON approval_route_snapshot_steps FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_guard();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.approval_route_snapshots'::regclass AND tgname='approval_route_snapshots_immutable_trg' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER approval_route_snapshots_immutable_trg BEFORE UPDATE OR DELETE ON approval_route_snapshots FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_guard();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/032_approval_engine_operationalization_phase1.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.approval_route_snapshots'::regclass AND tgname='approval_route_snapshots_validate_trg' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER approval_route_snapshots_validate_trg BEFORE INSERT ON approval_route_snapshots FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_validate();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/030_fixed_asset_physical_inventory.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.asset_inventory_expected_assets'::regclass AND tgname='asset_inventory_expected_immutable' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER asset_inventory_expected_immutable BEFORE UPDATE OR DELETE ON asset_inventory_expected_assets FOR EACH ROW EXECUTE FUNCTION prevent_inventory_snapshot_mutation();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/004_inventory_transaction_engine.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_transaction_allocations'::regclass AND tgname='trg_inventory_transaction_allocations_immutable' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER trg_inventory_transaction_allocations_immutable BEFORE UPDATE OR DELETE ON inventory_transaction_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_allocation_mutation();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/004_inventory_transaction_engine.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_transactions'::regclass AND tgname='trg_inventory_transactions_immutable' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER trg_inventory_transactions_immutable BEFORE UPDATE OR DELETE ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_posted_inventory_mutation();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/014_organization_hierarchy.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.organization_positions'::regclass AND tgname='organization_positions_institute_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER organization_positions_institute_guard BEFORE INSERT OR UPDATE OF organization_unit_id,user_id ON organization_positions FOR EACH ROW EXECUTE FUNCTION validate_organization_position_user();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/014_organization_hierarchy.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.organization_units'::regclass AND tgname='organization_units_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER organization_units_guard BEFORE INSERT OR UPDATE OF parent_unit_id,institute_id,department_id,section_id ON organization_units FOR EACH ROW EXECUTE FUNCTION validate_organization_unit();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rfid_antennas'::regclass AND tgname='rfid_antenna_scope_update_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER rfid_antenna_scope_update_guard BEFORE UPDATE OF institute_id, reader_id ON public.rfid_antennas FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_antenna_scope_update();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/018_fixed_assets_rfid_post_deployment_hardening.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rfid_portal_antennas'::regclass AND tgname='rfid_portal_antenna_scope_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER rfid_portal_antenna_scope_guard BEFORE INSERT OR UPDATE OF portal_id, antenna_id ON public.rfid_portal_antennas FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_portal_antenna_scope();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/018_fixed_assets_rfid_post_deployment_hardening.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rfid_portals'::regclass AND tgname='rfid_portal_enable_scope_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER rfid_portal_enable_scope_guard BEFORE UPDATE OF institute_id, enabled ON public.rfid_portals FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_portal_enable_scope();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/manual/027_rfid_configuration_mutation_guards.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rfid_readers'::regclass AND tgname='rfid_reader_scope_update_guard' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER rfid_reader_scope_update_guard BEFORE UPDATE OF institute_id ON public.rfid_readers FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_reader_scope_update();$trigger_body$;
  END IF;
END $trigger_install$;
-- Trigger source: sql/migrations/phase1b/03_mapping_constraints_and_indexes.sql
DO $trigger_install$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.stock_item_master_mappings'::regclass AND tgname='validate_stock_mapping_target_trigger' AND NOT tgisinternal) THEN
    EXECUTE $trigger_body$CREATE TRIGGER validate_stock_mapping_target_trigger BEFORE INSERT OR UPDATE OF generic_item_id,approved_product_id,mapping_status ON stock_item_master_mappings FOR EACH ROW EXECUTE FUNCTION validate_stock_mapping_target();$trigger_body$;
  END IF;
END $trigger_install$;
-- View source: sql/migrations/phase1b/05_reporting_views.sql
DO $view_install$ BEGIN
  IF to_regclass('public.stock_item_identity_read_model') IS NULL THEN
    EXECUTE $view_body$CREATE OR REPLACE VIEW stock_item_identity_read_model WITH (security_invoker=true) AS SELECT si.id,si.name AS legacy_name,si.description AS legacy_description,si.mapping_status,si.identity_source,si.generic_item_id,si.approved_product_id,
 COALESCE(g.generic_name,si.name) AS display_name, g.canonical_description,ap.manufacturer,ap.manufacturer_part_number,si.legacy_identity_snapshot
 FROM stock_items si LEFT JOIN generic_items g ON g.id=si.generic_item_id LEFT JOIN approved_products ap ON ap.id=si.approved_product_id;$view_body$;
  END IF;
END $view_install$;
-- View source: sql/migrations/phase1b/05_reporting_views.sql
DO $view_install$ BEGIN
  IF to_regclass('public.stock_item_mapping_coverage') IS NULL THEN
    EXECUTE $view_body$CREATE OR REPLACE VIEW stock_item_mapping_coverage WITH (security_invoker=true) AS SELECT mapping_status,category,sub_category,unit,COUNT(*) AS item_count,ROUND(100.0*COUNT(*)/NULLIF(SUM(COUNT(*)) OVER(),0),2) AS coverage_percent FROM stock_items GROUP BY mapping_status,category,sub_category,unit;$view_body$;
  END IF;
END $view_install$;
ALTER TABLE public.ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_authority_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_rule_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_shadow_differences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_shadow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_route_snapshot_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_route_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_expected_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_number_allocators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_number_allocators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_ai_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_clause_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_equipment_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_legal_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renewal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_required_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_sla_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_item_follow_up_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_priority_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_branding_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generic_item_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generic_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cycle_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservation_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservation_issue_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_allocation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_movement_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_receipt_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_match_override_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_duplicate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_master_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_master_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintainable_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_part_inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_work_order_allocators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_work_order_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_head_reconciliation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_item_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_service_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_case_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_case_complexity_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_offer_test_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_evaluation_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_identity_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_priority_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_priority_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_priority_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_priority_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_value_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_department_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_auto_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_edit_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_antennas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_business_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_integration_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_portal_antennas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfx_response_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_capability_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_part_equipment_compatibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_item_master_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_item_migration_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_section_assignments ENABLE ROW LEVEL SECURITY;
CREATE SEQUENCE IF NOT EXISTS public.purchase_order_number_seq;
DO $sequence_seed$ DECLARE governed_max bigint; previous_value bigint; BEGIN
 SELECT MAX(substring(po_number FROM '^PO-[0-9]{4}-([0-9]{6})$')::bigint) INTO governed_max FROM public.purchase_orders;
 SELECT last_value INTO previous_value FROM public.purchase_order_number_seq;
 IF governed_max IS NOT NULL AND governed_max >= previous_value THEN PERFORM setval('public.purchase_order_number_seq',governed_max,true); END IF;
END $sequence_seed$;
INSERT INTO public.procurement_identity_policy (id,enforce_item_identity,reason) VALUES (1,TRUE,'Strict Item Master enforcement by default') ON CONFLICT(id) DO NOTHING;
COMMIT;
