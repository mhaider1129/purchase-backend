-- Focused disposable test contract, not a production migration or schema dump.
-- Columns/constraints follow the connected P2P and inventory repositories, SQL
-- 004/006/031 and their later UOM/identity fields. Unused domains are omitted.
CREATE TABLE users (id SERIAL PRIMARY KEY,role TEXT DEFAULT 'Finance',institute_id INTEGER DEFAULT 1,department_id INTEGER,warehouse_id INTEGER,is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE departments (id SERIAL PRIMARY KEY,name TEXT DEFAULT 'Fixture department',institute_id INTEGER DEFAULT 1);
CREATE TABLE suppliers (id SERIAL PRIMARY KEY, name TEXT, status TEXT NOT NULL);
CREATE TABLE supplier_compliance_artifacts (id BIGSERIAL PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers,
  artifact_type TEXT, name TEXT, expiry_date DATE, status TEXT, blocked BOOLEAN);
CREATE TABLE supplier_evaluations (id BIGSERIAL PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers,
  evaluation_date DATE, overall_score NUMERIC, compliance_score NUMERIC, weighted_overall_score NUMERIC);
CREATE TABLE requests (id SERIAL PRIMARY KEY, institute_id INTEGER DEFAULT 1, department_id INTEGER REFERENCES departments, project_id UUID, status TEXT);
CREATE TABLE item_uom (id SERIAL PRIMARY KEY, name TEXT, uom_code TEXT, is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE generic_items (id BIGSERIAL PRIMARY KEY, base_uom_id INTEGER REFERENCES item_uom,
  inventory_uom_id INTEGER REFERENCES item_uom, lifecycle_status TEXT, is_active BOOLEAN,
  item_code TEXT,generic_name TEXT,canonical_description TEXT,inventory_uom TEXT,interchangeability_policy TEXT);
CREATE TABLE approved_products (id BIGSERIAL PRIMARY KEY, generic_item_id BIGINT REFERENCES generic_items,
  product_name TEXT, product_description TEXT, package_quantity NUMERIC(18,4), approval_status TEXT, is_active BOOLEAN);
CREATE TABLE supplier_catalog_items (id BIGSERIAL PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers,
  approved_product_id BIGINT REFERENCES approved_products, purchasing_uom_id INTEGER REFERENCES item_uom,
  conversion_factor NUMERIC(18,4), is_active BOOLEAN);
CREATE TABLE requested_items (id SERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  approval_status TEXT DEFAULT 'Approved',
  generic_item_id BIGINT REFERENCES generic_items, quantity INTEGER NOT NULL,
  preferred_product_id BIGINT REFERENCES approved_products, mandatory_product_id BIGINT REFERENCES approved_products, request_mode TEXT CONSTRAINT requested_items_request_mode_check CHECK(request_mode IN ('generic_item','generic_item_with_preference','specific_approved_product','free_text','pending_item_creation','approved_free_text_exception','service')),
  catalog_status TEXT CONSTRAINT requested_items_catalog_status_check CHECK(catalog_status IN ('catalogued','pending_mapping','approved_exception')),
  canonical_description_snapshot TEXT, item_name_snapshot TEXT, item_name VARCHAR NOT NULL, unit_of_measure TEXT,
  brand TEXT,unit_cost BIGINT,total_cost BIGINT,available_quantity INTEGER,intended_use TEXT,specs TEXT,
  device_info JSONB,purchase_type TEXT,stocking_policy TEXT CHECK(stocking_policy IN ('stock','non_stock','consignment','direct_delivery','service')),
  preferred_product_reason TEXT,restriction_justification TEXT,required_date DATE);
CREATE TABLE item_master_audit_events(id BIGSERIAL PRIMARY KEY,entity_type TEXT,entity_id BIGINT,action TEXT,actor_id INTEGER REFERENCES users,reason TEXT,
  previous_values JSONB,new_values JSONB,request_id INTEGER REFERENCES requests,requested_item_id INTEGER REFERENCES requested_items,source_id BIGINT,target_id BIGINT,organizational_context JSONB);
CREATE TABLE warehouses (id SERIAL PRIMARY KEY, institute_id INTEGER, name TEXT, is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE stock_items (id SERIAL PRIMARY KEY, generic_item_id BIGINT REFERENCES generic_items,
  approved_product_id BIGINT REFERENCES approved_products, inventory_uom_id INTEGER REFERENCES item_uom,
  mapping_status TEXT NOT NULL DEFAULT 'unmapped' CHECK(mapping_status IN ('unmapped','auto_matched','review_required','mapped_generic','mapped_product','duplicate','obsolete','excluded')),
  name TEXT, unit TEXT, available_quantity NUMERIC(18,4) DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE procurement_awards (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  request_item_id INTEGER REFERENCES requested_items, supplier_id INTEGER REFERENCES suppliers,
  approved_product_id BIGINT REFERENCES approved_products, supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items,
  awarded_quantity NUMERIC(18,4), unit_price NUMERIC(18,4), currency TEXT, source_type TEXT, source_id TEXT,
  selection_reason TEXT, actor_id INTEGER REFERENCES users, idempotency_key TEXT UNIQUE,
  payload_fingerprint TEXT, status TEXT);
CREATE SEQUENCE purchase_order_number_seq;
CREATE TABLE purchase_orders (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  supplier_id INTEGER REFERENCES suppliers, currency TEXT, status TEXT, expected_delivery_date DATE,
  delivery_location TEXT, budget_cost_center TEXT, created_by INTEGER REFERENCES users,
  rfx_id BIGINT, rfx_response_id BIGINT, po_number TEXT UNIQUE, notes TEXT, total_amount NUMERIC(14,2),
  approval_required BOOLEAN, approval_route TEXT, approved_by INTEGER REFERENCES users, approved_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ, issue_event_at TIMESTAMPTZ, issued_to_supplier_at TIMESTAMPTZ,
  issued_by INTEGER REFERENCES users, cancellation_reason TEXT, amendment_reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE purchase_order_items (id BIGSERIAL PRIMARY KEY, purchase_order_id BIGINT REFERENCES purchase_orders,
  requested_item_id INTEGER REFERENCES requested_items, award_id BIGINT REFERENCES procurement_awards,
  generic_item_id BIGINT REFERENCES generic_items, approved_product_id BIGINT REFERENCES approved_products,
  supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items, item_name TEXT,
  quantity NUMERIC(18,4), received_quantity NUMERIC(18,4) DEFAULT 0, unit_price NUMERIC(18,4),
  price_source_type TEXT, price_source_id TEXT, line_type TEXT CHECK (line_type IN ('INVENTORY','NON_INVENTORY','SERVICE','ASSET','MEDICAL_DEVICE')),
  source_uom_id INTEGER REFERENCES item_uom, source_uom TEXT, base_uom_id INTEGER REFERENCES item_uom,
  base_uom TEXT, conversion_factor NUMERIC(18,4));
CREATE TABLE budget_envelopes (id BIGSERIAL PRIMARY KEY, department_id INTEGER REFERENCES departments,
  project_id UUID, fiscal_year INTEGER, currency TEXT, allocated_amount NUMERIC(14,2), consumed_amount NUMERIC(14,2) DEFAULT 0);
CREATE TABLE goods_receipts (id BIGSERIAL PRIMARY KEY, purchase_order_id BIGINT REFERENCES purchase_orders,
  request_id INTEGER REFERENCES requests, idempotency_key TEXT UNIQUE, payload_fingerprint TEXT,
  receipt_number TEXT UNIQUE, warehouse_location TEXT, received_at TIMESTAMPTZ, received_by INTEGER REFERENCES users,
  notes TEXT, discrepancy_notes TEXT);
CREATE TABLE goods_receipt_items (id BIGSERIAL PRIMARY KEY, goods_receipt_id BIGINT REFERENCES goods_receipts,
  purchase_order_item_id BIGINT REFERENCES purchase_order_items, requested_item_id INTEGER REFERENCES requested_items,
  item_name TEXT, ordered_quantity NUMERIC(18,4), received_quantity NUMERIC(18,4),
  damaged_quantity NUMERIC(18,4) DEFAULT 0, short_quantity NUMERIC(18,4) DEFAULT 0,
  unit_price NUMERIC(18,4), line_notes TEXT, batch_number TEXT, lot_number TEXT, serial_number TEXT,
  expiry_date DATE, warehouse_id INTEGER REFERENCES warehouses, stock_status TEXT,
  generic_item_id BIGINT REFERENCES generic_items, approved_product_id BIGINT REFERENCES approved_products,
  supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items, source_uom TEXT, base_uom TEXT,
  conversion_factor NUMERIC(18,4), stock_item_id INTEGER REFERENCES stock_items);
CREATE TABLE supplier_invoices (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  supplier_id INTEGER REFERENCES suppliers, purchase_order_id BIGINT REFERENCES purchase_orders,
  invoice_number TEXT, normalized_invoice_number TEXT, invoice_date DATE, currency TEXT,
  idempotency_key TEXT UNIQUE, payload_fingerprint TEXT, status TEXT, subtotal_amount NUMERIC(14,2),
  tax_amount NUMERIC(14,2), discount_amount NUMERIC(14,2), total_amount NUMERIC(14,2),
  attachment_metadata JSONB, submitted_by INTEGER REFERENCES users, updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id,normalized_invoice_number));
CREATE TABLE invoice_items (id BIGSERIAL PRIMARY KEY, supplier_invoice_id BIGINT REFERENCES supplier_invoices,
  purchase_order_item_id BIGINT REFERENCES purchase_order_items, requested_item_id INTEGER REFERENCES requested_items,
  description TEXT, quantity NUMERIC(18,4), unit_price NUMERIC(18,4), line_total NUMERIC(14,2),
  tax_amount NUMERIC(14,2), discount_amount NUMERIC(14,2));
CREATE TABLE invoice_match_results (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  supplier_invoice_id BIGINT REFERENCES supplier_invoices, match_policy TEXT, match_status TEXT,
  mismatch_reasons JSONB, variances JSONB, matched_by INTEGER REFERENCES users, matched_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE invoice_match_override_decisions (id BIGSERIAL PRIMARY KEY,
  invoice_match_result_id BIGINT REFERENCES invoice_match_results, decision TEXT, reason TEXT,
  actor_id INTEGER REFERENCES users, original_variances JSONB, decided_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE ap_vouchers (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  supplier_invoice_id BIGINT REFERENCES supplier_invoices, voucher_number TEXT UNIQUE, voucher_status TEXT,
  currency TEXT, total_amount NUMERIC(14,2), created_by INTEGER REFERENCES users,
  idempotency_key TEXT UNIQUE, payload_fingerprint TEXT, verified_by INTEGER REFERENCES users,
  verified_at TIMESTAMPTZ, posted_by INTEGER REFERENCES users, posted_at TIMESTAMPTZ);
CREATE TABLE ap_voucher_lines (id BIGSERIAL PRIMARY KEY, ap_voucher_id BIGINT REFERENCES ap_vouchers,
  line_number INTEGER, account_code TEXT, description TEXT, debit_amount NUMERIC(14,2) DEFAULT 0,
  credit_amount NUMERIC(14,2) DEFAULT 0, reference_type TEXT, reference_id TEXT);
CREATE TABLE ap_payables (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  supplier_id INTEGER NOT NULL CONSTRAINT ap_payables_supplier_id_fkey REFERENCES suppliers,
  supplier_invoice_id BIGINT REFERENCES supplier_invoices UNIQUE,
  ap_voucher_id BIGINT REFERENCES ap_vouchers UNIQUE, supplier_name TEXT,
  invoice_total NUMERIC(14,2), open_balance NUMERIC(14,2) CHECK (open_balance>=0), currency TEXT,
  payable_status TEXT, posted_by INTEGER REFERENCES users);
CREATE INDEX idx_ap_payables_supplier_id ON ap_payables(supplier_id);
CREATE TABLE commitment_ledger (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  budget_envelope_id BIGINT REFERENCES budget_envelopes, purchase_order_id BIGINT REFERENCES purchase_orders,
  stage TEXT, state TEXT, amount NUMERIC(14,2) CHECK (amount>=0), currency TEXT, source_type TEXT,
  source_id TEXT, parent_commitment_id BIGINT REFERENCES commitment_ledger,
  supplier_invoice_id BIGINT REFERENCES supplier_invoices, ap_voucher_id BIGINT REFERENCES ap_vouchers,
  idempotency_key TEXT UNIQUE, actor_id INTEGER REFERENCES users);
CREATE UNIQUE INDEX one_active_po_encumbrance ON commitment_ledger(purchase_order_id)
  WHERE stage='encumbrance' AND state='ACTIVE';
CREATE UNIQUE INDEX one_voucher_actual ON commitment_ledger(ap_voucher_id) WHERE stage='actual';
CREATE TABLE finance_postings (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  ap_voucher_id BIGINT REFERENCES ap_vouchers UNIQUE, supplier_invoice_id BIGINT REFERENCES supplier_invoices,
  posting_status TEXT, liability_recognized_amount NUMERIC(14,2), idempotency_key TEXT UNIQUE,
  posted_by INTEGER REFERENCES users, posted_at TIMESTAMPTZ);
CREATE TABLE payment_records (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  ap_voucher_id BIGINT REFERENCES ap_vouchers, supplier_invoice_id BIGINT REFERENCES supplier_invoices,
  payment_status TEXT, payment_reference TEXT, payment_method TEXT, amount_paid NUMERIC(14,2),
  currency TEXT, idempotency_key TEXT UNIQUE, payload_fingerprint TEXT, paid_by INTEGER REFERENCES users, paid_at TIMESTAMPTZ);
CREATE TABLE payment_allocations (id BIGSERIAL PRIMARY KEY, payment_record_id BIGINT REFERENCES payment_records,
  ap_payable_id BIGINT REFERENCES ap_payables, amount NUMERIC(14,2) CHECK (amount>0));
CREATE TABLE document_flow_links (id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests,
  source_document_type TEXT, source_document_id TEXT, target_document_type TEXT,
  target_document_id TEXT, created_by INTEGER REFERENCES users,
  CONSTRAINT document_flow_links_unique_edge UNIQUE (request_id,source_document_type,source_document_id,target_document_type,target_document_id));
CREATE TABLE audit_logs (id BIGSERIAL PRIMARY KEY, action TEXT, action_type TEXT,
  actor_id INTEGER REFERENCES users, target_type TEXT, target_id TEXT, description TEXT, details JSONB);
CREATE TABLE notification_outbox (id BIGSERIAL PRIMARY KEY, event_type TEXT, entity_type TEXT,
  entity_id TEXT, recipient_user_id INTEGER REFERENCES users, payload JSONB, idempotency_key TEXT UNIQUE, status TEXT);
CREATE TABLE warehouse_stock_levels (id BIGSERIAL PRIMARY KEY, warehouse_id INTEGER REFERENCES warehouses,
  stock_item_id INTEGER REFERENCES stock_items, item_name TEXT, quantity NUMERIC(18,4) CHECK (quantity>=0),
  reserved_quantity NUMERIC(18,4) DEFAULT 0, updated_by INTEGER REFERENCES users,
  stock_status TEXT, batch_number TEXT, lot_number TEXT, serial_number TEXT, expiry_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (warehouse_id,stock_item_id,stock_status,batch_number,lot_number,serial_number,expiry_date));
CREATE TABLE inventory_transactions (id BIGSERIAL PRIMARY KEY, transaction_type TEXT, movement_type TEXT,
  source_location TEXT, destination_location TEXT, warehouse_id INTEGER REFERENCES warehouses,
  department_id INTEGER REFERENCES departments, stock_item_id INTEGER REFERENCES stock_items, quantity NUMERIC(18,4),
  base_uom TEXT, source_quantity NUMERIC(18,4), source_uom TEXT, conversion_factor NUMERIC(18,4),
  batch_number TEXT, lot_number TEXT, serial_number TEXT, expiry_date DATE, stock_status TEXT,
  source_document_type TEXT, source_document_id TEXT, source_document_line_id TEXT, reference_document TEXT,
  notes TEXT, created_by INTEGER REFERENCES users, institute_id INTEGER,
  idempotency_key TEXT UNIQUE, correlation_id TEXT, metadata JSONB,
  reversal_of_movement_id BIGINT REFERENCES inventory_transactions, command_fingerprint TEXT);
CREATE TABLE inventory_transaction_allocations (id BIGSERIAL PRIMARY KEY,
  inventory_transaction_id BIGINT REFERENCES inventory_transactions,
  warehouse_stock_level_id BIGINT REFERENCES warehouse_stock_levels, warehouse_id INTEGER REFERENCES warehouses,
  stock_item_id INTEGER REFERENCES stock_items, stock_status TEXT, quantity NUMERIC(18,4),
  batch_number TEXT, lot_number TEXT, serial_number TEXT, expiry_date DATE, base_uom TEXT, allocation_sequence INTEGER);
INSERT INTO users DEFAULT VALUES;
INSERT INTO suppliers(name,status) VALUES ('Integration supplier','active');
INSERT INTO item_uom(name,uom_code) VALUES ('Each','EA');

-- Explicit grants for security-aware disposable integrations; no role shortcut.
CREATE TABLE projects(id UUID PRIMARY KEY,name TEXT,is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE permissions(id SERIAL PRIMARY KEY,code TEXT UNIQUE,name TEXT,description TEXT);
CREATE TABLE roles(id SERIAL PRIMARY KEY,name TEXT UNIQUE);
CREATE TABLE user_permissions(user_id INTEGER,permission_id INTEGER);
CREATE TABLE role_permissions(role_id INTEGER,permission_id INTEGER);
CREATE TABLE data_scopes(id SERIAL PRIMARY KEY,code TEXT UNIQUE);
CREATE TABLE user_data_scopes(user_id INTEGER,data_scope_id INTEGER,scope_value TEXT);
CREATE TABLE role_data_scopes(role_id INTEGER,data_scope_id INTEGER,scope_value TEXT);
ALTER TABLE suppliers ADD COLUMN institute_id INTEGER;
ALTER TABLE supplier_invoices ADD COLUMN receipt_id BIGINT;
ALTER TABLE ap_voucher_lines ADD COLUMN cost_center_id INTEGER;
CREATE TABLE finance_cost_centers(id SERIAL PRIMARY KEY,department_id INTEGER,project_id UUID,is_active BOOLEAN DEFAULT TRUE);
INSERT INTO users(id,role,institute_id,is_active) VALUES(2,'Finance',1,true),(3,'SCM',1,true),(4,'Finance',2,true),(5,'Admin',1,true),(6,'Finance',1,false);
INSERT INTO permissions(code) SELECT unnest(ARRAY['rfx.manage','rfx.respond','procure-to-pay.lifecycle.view','procure-to-pay.purchase-orders.manage','procure-to-pay.receipts.manage','procure-to-pay.invoices.manage','procure-to-pay.match.manage','finance.verify','finance.voucher.create','finance.voucher.verify','finance.post-ledger','finance.payment.manage','finance.override-mismatch','finance.budget.manage','inventory.receive','inventory.cross-warehouse']);
INSERT INTO user_permissions SELECT u.id,p.id FROM users u CROSS JOIN permissions p WHERE u.id IN(1,2,4,6);

ALTER TABLE supplier_invoices ADD COLUMN supplier TEXT;
ALTER TABLE supplier_invoices ADD COLUMN submitted_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE purchase_orders ADD COLUMN supplier_name TEXT;
ALTER TABLE purchase_orders ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE budget_envelopes ADD COLUMN created_by INTEGER;
ALTER TABLE budget_envelopes ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE rfx_events(id BIGSERIAL PRIMARY KEY,request_id INTEGER REFERENCES requests);
CREATE TABLE rfx_responses(id BIGSERIAL PRIMARY KEY,rfx_id BIGINT REFERENCES rfx_events,request_id INTEGER REFERENCES requests,supplier_id INTEGER REFERENCES suppliers);

ALTER TABLE warehouses ADD COLUMN department_id INTEGER REFERENCES departments;

ALTER TABLE requests ADD COLUMN supply_warehouse_id INTEGER REFERENCES warehouses;

ALTER TABLE approved_products ADD COLUMN institute_id INTEGER;
ALTER TABLE rfx_events ADD COLUMN title TEXT,ADD COLUMN rfx_type TEXT,ADD COLUMN description TEXT,ADD COLUMN details JSONB,ADD COLUMN due_date TIMESTAMPTZ,ADD COLUMN status TEXT DEFAULT 'open',ADD COLUMN created_by INTEGER,ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE rfx_responses ADD COLUMN submitted_by INTEGER,ADD COLUMN bid_amount NUMERIC,ADD COLUMN notes TEXT,ADD COLUMN response_data JSONB,ADD COLUMN status TEXT DEFAULT 'submitted',ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
CREATE TABLE rfx_response_items(id BIGSERIAL PRIMARY KEY,rfx_response_id BIGINT REFERENCES rfx_responses,requested_item_id INTEGER REFERENCES requested_items,quoted_quantity NUMERIC,free_quantity NUMERIC,unit_price NUMERIC,currency TEXT,brand TEXT,offered_specs TEXT,notes TEXT,approved_product_id BIGINT REFERENCES approved_products,supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items);
ALTER TABLE requested_items ADD COLUMN approval_comments TEXT;
ALTER TABLE requests ADD COLUMN sourcing_status TEXT,ADD COLUMN purchase_order_id BIGINT,ADD COLUMN awarded_supplier_id INTEGER,ADD COLUMN awarded_rfx_id BIGINT,ADD COLUMN awarded_rfx_response_id BIGINT,ADD COLUMN purchase_order_number TEXT,ADD COLUMN awarded_at TIMESTAMPTZ,ADD COLUMN po_issued_at TIMESTAMPTZ;
CREATE TABLE request_logs(id BIGSERIAL PRIMARY KEY,request_id INTEGER,action TEXT,actor_id INTEGER,comments TEXT);

CREATE TABLE approvals(id SERIAL PRIMARY KEY,request_id INTEGER REFERENCES requests,status TEXT,is_superseded BOOLEAN DEFAULT FALSE);

ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE requests ADD COLUMN requester_id INTEGER,ADD COLUMN temporary_requester_name TEXT,ADD COLUMN justification TEXT;

-- Independent evaluation tables: focused disposable subset of the existing contract.
CREATE TABLE sections(id SERIAL PRIMARY KEY,department_id INTEGER REFERENCES departments);

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(evaluation_case_id,offer_id)
);

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

INSERT INTO permissions(code) VALUES('evaluations.manage');
INSERT INTO user_permissions SELECT 1,id FROM permissions WHERE code='evaluations.manage';
