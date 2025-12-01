-- Full Supabase schema for purchase tracker domain.
-- Includes approval routing, procurement, warehouse stock workflows, and auditing tables.

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid() usage.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Sequences backing serial/identity-like integer columns.
CREATE SEQUENCE IF NOT EXISTS public.approval_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.approval_routes_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.approvals_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.attachments_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.audit_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.contract_evaluations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.contracts_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.custody_records_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.departments_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.evaluation_criteria_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.item_recalls_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.maintenance_stock_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.notifications_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.permissions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.procurement_plans_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.request_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.requested_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.requests_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.roles_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.sections_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.stock_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_stock_levels_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_stock_movements_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.supplier_evaluations_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.technical_inspections_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.user_registration_requests_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.users_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_supplied_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_supply_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_supply_templates_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouses_id_seq;

CREATE TABLE IF NOT EXISTS public.approval_logs (
  id integer NOT NULL DEFAULT nextval('approval_logs_id_seq'::regclass),
  approval_id integer,
  request_id integer,
  approver_id integer,
  action character varying,
  comments text,
  timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT approval_logs_pkey PRIMARY KEY (id),
  CONSTRAINT approval_logs_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.approvals(id),
  CONSTRAINT approval_logs_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT approval_logs_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.approval_routes (
  id integer NOT NULL DEFAULT nextval('approval_routes_id_seq'::regclass),
  request_type character varying NOT NULL,
  department_type character varying NOT NULL,
  approval_level integer NOT NULL,
  role character varying NOT NULL,
  min_amount bigint DEFAULT 0,
  max_amount bigint DEFAULT 999999999,
  CONSTRAINT approval_routes_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.approvals (
  id integer NOT NULL DEFAULT nextval('approvals_id_seq'::regclass),
  request_id integer,
  approver_id integer,
  approval_level integer,
  status character varying DEFAULT 'Pending'::character varying,
  comments text,
  approved_at timestamp without time zone,
  is_active boolean DEFAULT false,
  is_urgent boolean DEFAULT false,
  reminder_sent_at timestamp with time zone,
  CONSTRAINT approvals_pkey PRIMARY KEY (id),
  CONSTRAINT approvals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.attachments (
  id integer NOT NULL DEFAULT nextval('attachments_id_seq'::regclass),
  request_id integer,
  file_name text NOT NULL,
  file_path text NOT NULL,
  uploaded_by integer,
  uploaded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  item_id bigint,
  contract_id bigint,
  CONSTRAINT attachments_pkey PRIMARY KEY (id),
  CONSTRAINT attachments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id),
  CONSTRAINT attachments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.requested_items(id),
  CONSTRAINT attachments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass),
  action text,
  action_type text,
  actor_id integer,
  user_id integer,
  target_type text,
  target_id integer,
  description text,
  details text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.contract_evaluations (
  id integer NOT NULL DEFAULT nextval('contract_evaluations_id_seq'::regclass),
  contract_id integer NOT NULL,
  evaluator_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  evaluation_notes text,
  evaluation_criteria jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  criterion_id integer,
  criterion_name text,
  criterion_role text,
  criterion_code text,
  CONSTRAINT contract_evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT contract_evaluations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id),
  CONSTRAINT contract_evaluations_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id),
  CONSTRAINT contract_evaluations_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.evaluation_criteria(id)
);

CREATE TABLE IF NOT EXISTS public.contracts (
  id integer NOT NULL DEFAULT nextval('contracts_id_seq'::regclass),
  title text NOT NULL,
  vendor text NOT NULL,
  reference_number text,
  start_date date,
  end_date date,
  contract_value numeric,
  amount_paid numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'active'::text,
  description text,
  created_by integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  delivery_terms text,
  warranty_terms text,
  performance_management text,
  end_user_department_id integer,
  contract_manager_id integer,
  technical_department_ids jsonb,
  CONSTRAINT contracts_pkey PRIMARY KEY (id),
  CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT contracts_end_user_department_id_fkey FOREIGN KEY (end_user_department_id) REFERENCES public.departments(id),
  CONSTRAINT contracts_contract_manager_id_fkey FOREIGN KEY (contract_manager_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.custody_records (
  id integer NOT NULL DEFAULT nextval('custody_records_id_seq'::regclass),
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  description text,
  custody_type text NOT NULL CHECK (custody_type = ANY (ARRAY['Personal'::text, 'Departmental'::text])),
  custody_code text,
  issued_by integer NOT NULL,
  custodian_user_id integer,
  custodian_department_id integer,
  hod_user_id integer,
  user_approval_status text NOT NULL DEFAULT 'Pending'::text,
  user_approved_at timestamp without time zone,
  hod_approval_status text NOT NULL DEFAULT 'Pending'::text,
  hod_approved_at timestamp without time zone,
  status text NOT NULL DEFAULT 'Pending'::text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT custody_records_pkey PRIMARY KEY (id),
  CONSTRAINT custody_records_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id),
  CONSTRAINT custody_records_custodian_user_id_fkey FOREIGN KEY (custodian_user_id) REFERENCES public.users(id),
  CONSTRAINT custody_records_custodian_department_id_fkey FOREIGN KEY (custodian_department_id) REFERENCES public.departments(id),
  CONSTRAINT custody_records_hod_user_id_fkey FOREIGN KEY (hod_user_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.departments (
  id integer NOT NULL DEFAULT nextval('departments_id_seq'::regclass),
  name character varying NOT NULL,
  type character varying NOT NULL CHECK (type::text = ANY (ARRAY['Medical'::character varying::text, 'Operational'::character varying::text])),
  CONSTRAINT departments_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.evaluation_criteria (
  id integer NOT NULL DEFAULT nextval('evaluation_criteria_id_seq'::regclass),
  name text NOT NULL,
  role text NOT NULL,
  components jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  code text,
  assignment_config jsonb,
  CONSTRAINT evaluation_criteria_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.item_recalls (
  id integer NOT NULL DEFAULT nextval('item_recalls_id_seq'::regclass),
  item_id integer,
  item_name text NOT NULL,
  quantity integer,
  reason text NOT NULL,
  notes text,
  department_id integer NOT NULL,
  initiated_by_user_id integer NOT NULL,
  recall_type text NOT NULL CHECK (recall_type = ANY (ARRAY['department_to_warehouse'::text, 'warehouse_to_procurement'::text])),
  status text NOT NULL DEFAULT 'Pending Warehouse Review'::text,
  escalated_to_procurement boolean NOT NULL DEFAULT false,
  escalated_at timestamp without time zone,
  escalated_by_user_id integer,
  warehouse_notes text,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT item_recalls_pkey PRIMARY KEY (id),
  CONSTRAINT item_recalls_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.stock_items(id),
  CONSTRAINT item_recalls_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT item_recalls_initiated_by_user_id_fkey FOREIGN KEY (initiated_by_user_id) REFERENCES public.users(id),
  CONSTRAINT item_recalls_escalated_by_user_id_fkey FOREIGN KEY (escalated_by_user_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.maintenance_stock (
  id integer NOT NULL DEFAULT nextval('maintenance_stock_id_seq'::regclass),
  item_name text NOT NULL UNIQUE,
  quantity integer NOT NULL DEFAULT 0,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT maintenance_stock_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id integer NOT NULL DEFAULT nextval('notifications_id_seq'::regclass),
  user_id integer NOT NULL,
  title text,
  message text NOT NULL,
  link text,
  metadata jsonb,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id integer NOT NULL DEFAULT nextval('permissions_id_seq'::regclass),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  CONSTRAINT permissions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.procurement_plans (
  id integer NOT NULL DEFAULT nextval('procurement_plans_id_seq'::regclass),
  department_id integer,
  plan_year integer NOT NULL,
  file_name character varying,
  file_path text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT procurement_plans_pkey PRIMARY KEY (id),
  CONSTRAINT procurement_plans_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id)
);

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  created_by integer,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.request_logs (
  id integer NOT NULL DEFAULT nextval('request_logs_id_seq'::regclass),
  request_id integer,
  action character varying NOT NULL,
  actor_id integer,
  comments text,
  timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT request_logs_pkey PRIMARY KEY (id),
  CONSTRAINT request_logs_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT request_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.requested_items (
  id integer NOT NULL DEFAULT nextval('requested_items_id_seq'::regclass),
  request_id integer,
  item_name character varying NOT NULL,
  quantity integer NOT NULL,
  unit_cost bigint,
  available_quantity integer,
  intended_use text,
  specs text,
  device_info jsonb,
  purchase_type character varying CHECK (purchase_type::text = ANY (ARRAY['First Time'::character varying, 'Replacement'::character varying, 'Addition'::character varying]::text[])),
  approval_status character varying DEFAULT 'Pending'::character varying,
  total_cost bigint,
  procurement_status character varying DEFAULT 'pending'::character varying,
  procurement_comment text,
  marked_by integer,
  marked_at timestamp without time zone,
  procurement_updated_by integer,
  procurement_updated_at timestamp without time zone,
  purchased_quantity integer DEFAULT 0,
  brand text,
  approval_comments text,
  approved_by integer,
  approved_at timestamp with time zone,
  is_received boolean DEFAULT false,
  received_by integer,
  received_at timestamp with time zone,
  CONSTRAINT requested_items_pkey PRIMARY KEY (id),
  CONSTRAINT requested_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT requested_items_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id),
  CONSTRAINT requested_items_procurement_updated_by_fkey FOREIGN KEY (procurement_updated_by) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.requests (
  id integer NOT NULL DEFAULT nextval('requests_id_seq'::regclass),
  request_type character varying NOT NULL CHECK (request_type::text = ANY (ARRAY['Stock'::character varying, 'Non-Stock'::character varying, 'Medical Device'::character varying, 'Medication'::character varying, 'IT Item'::character varying, 'Maintenance'::character varying, 'Warehouse Supply'::character varying]::text[])),
  requester_id integer,
  department_id integer,
  status character varying DEFAULT 'Submitted'::character varying,
  justification text,
  estimated_cost bigint,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  assigned_to integer,
  request_domain character varying DEFAULT 'operational'::character varying CHECK (request_domain::text = ANY (ARRAY['medical'::character varying, 'operational'::character varying]::text[])),
  is_urgent boolean DEFAULT false,
  maintenance_ref_number text,
  initiated_by_technician_id integer,
  section_id integer,
  completed_at timestamp without time zone,
  print_count integer NOT NULL DEFAULT 0,
  project_id uuid,
  temporary_requester_name text,
  supply_warehouse_id integer,
  CONSTRAINT requests_pkey PRIMARY KEY (id),
  CONSTRAINT requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id),
  CONSTRAINT requests_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT requests_initiated_by_technician_id_fkey FOREIGN KEY (initiated_by_technician_id) REFERENCES public.users(id),
  CONSTRAINT requests_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id),
  CONSTRAINT requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id),
  CONSTRAINT requests_supply_warehouse_id_fkey FOREIGN KEY (supply_warehouse_id) REFERENCES public.warehouses(id)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id integer NOT NULL,
  permission_id integer NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id),
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id integer NOT NULL DEFAULT nextval('roles_id_seq'::regclass),
  name character varying NOT NULL UNIQUE,
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.sections (
  id integer NOT NULL DEFAULT nextval('sections_id_seq'::regclass),
  name character varying NOT NULL,
  department_id integer,
  CONSTRAINT sections_pkey PRIMARY KEY (id),
  CONSTRAINT sections_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id)
);

CREATE TABLE IF NOT EXISTS public.stock_item_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  description text,
  unit text,
  requested_by integer,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  approved_by integer,
  inserted_at timestamp with time zone DEFAULT now(),
  review_notes text,
  CONSTRAINT stock_item_requests_pkey PRIMARY KEY (id),
  CONSTRAINT stock_item_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id),
  CONSTRAINT stock_item_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.stock_items (
  id integer NOT NULL DEFAULT nextval('stock_items_id_seq'::regclass),
  name text NOT NULL,
  brand text,
  cost numeric,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  category character varying,
  unit text,
  created_by integer,
  sub_category text,
  available_quantity numeric,
  CONSTRAINT stock_items_pkey PRIMARY KEY (id),
  CONSTRAINT stock_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

-- Stock availability per warehouse
CREATE TABLE IF NOT EXISTS public.warehouse_stock_levels (
  id integer NOT NULL DEFAULT nextval('warehouse_stock_levels_id_seq'::regclass),
  warehouse_id integer NOT NULL,
  stock_item_id integer NOT NULL,
  item_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  updated_by integer,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT warehouse_stock_levels_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_stock_levels_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id),
  CONSTRAINT warehouse_stock_levels_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id),
  CONSTRAINT warehouse_stock_levels_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
);

-- Stock movements for audit trail
CREATE TABLE IF NOT EXISTS public.warehouse_stock_movements (
  id integer NOT NULL DEFAULT nextval('warehouse_stock_movements_id_seq'::regclass),
  warehouse_id integer NOT NULL,
  stock_item_id integer,
  item_name text NOT NULL,
  direction text NOT NULL CHECK (direction = ANY (ARRAY['in'::text, 'out'::text])),
  quantity numeric NOT NULL,
  reference_request_id integer,
  to_department_id integer,
  notes text,
  created_by integer,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT warehouse_stock_movements_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_stock_movements_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id),
  CONSTRAINT warehouse_stock_movements_reference_request_id_fkey FOREIGN KEY (reference_request_id) REFERENCES public.requests(id),
  CONSTRAINT warehouse_stock_movements_to_department_id_fkey FOREIGN KEY (to_department_id) REFERENCES public.departments(id),
  CONSTRAINT warehouse_stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT warehouse_stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
);

CREATE TABLE IF NOT EXISTS public.supplier_evaluations (
  id integer NOT NULL DEFAULT nextval('supplier_evaluations_id_seq'::regclass),
  supplier_name text NOT NULL,
  evaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  quality_score numeric,
  delivery_score numeric,
  cost_score numeric,
  compliance_score numeric,
  overall_score numeric NOT NULL,
  strengths text,
  weaknesses text,
  action_items text,
  evaluator_id integer,
  evaluator_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  otif_score numeric,
  corrective_actions_score numeric,
  esg_compliance_score numeric,
  weighted_overall_score numeric,
  kpi_weights jsonb,
  criteria_responses jsonb,
  CONSTRAINT supplier_evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT supplier_evaluations_evaluator_id_fkey FOREIGN KEY (evaluator_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.technical_inspections (
  id integer NOT NULL DEFAULT nextval('technical_inspections_id_seq'::regclass),
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  location text,
  item_name text NOT NULL,
  item_category text,
  model_number text,
  serial_number text,
  lot_number text,
  manufacturer text,
  supplier_name text,
  general_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  inspectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  approvals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by integer,
  created_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT technical_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT technical_inspections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.ui_resource_permissions (
  resource_key text NOT NULL,
  label text NOT NULL,
  description text,
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  require_all boolean NOT NULL DEFAULT false,
  CONSTRAINT ui_resource_permissions_pkey PRIMARY KEY (resource_key)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id integer NOT NULL,
  permission_id integer NOT NULL,
  CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission_id),
  CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);

CREATE TABLE IF NOT EXISTS public.user_registration_requests (
  id integer NOT NULL DEFAULT nextval('user_registration_requests_id_seq'::regclass),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  requested_role text NOT NULL DEFAULT 'requester'::text,
  department_id integer NOT NULL,
  section_id integer,
  status text NOT NULL DEFAULT 'pending'::text,
  rejection_reason text,
  reviewer_id integer,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  employee_id text,
  CONSTRAINT user_registration_requests_pkey PRIMARY KEY (id),
  CONSTRAINT user_registration_requests_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT user_registration_requests_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id),
  CONSTRAINT user_registration_requests_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.users (
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  password character varying NOT NULL,
  role character varying NOT NULL,
  department_id integer,
  section_id integer,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  is_active boolean DEFAULT true,
  can_request_medication boolean DEFAULT false,
  employee_id text,
  warehouse_id integer,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT users_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id),
  CONSTRAINT users_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
);

CREATE TABLE IF NOT EXISTS public.warehouse_supplied_items (
  id integer NOT NULL DEFAULT nextval('warehouse_supplied_items_id_seq'::regclass),
  request_id integer NOT NULL,
  item_id integer NOT NULL,
  supplied_quantity integer NOT NULL,
  supplied_by integer,
  supplied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT warehouse_supplied_items_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_supplied_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id),
  CONSTRAINT warehouse_supplied_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.warehouse_supply_items(id),
  CONSTRAINT warehouse_supplied_items_supplied_by_fkey FOREIGN KEY (supplied_by) REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.warehouse_supply_items (
  id integer NOT NULL DEFAULT nextval('warehouse_supply_items_id_seq'::regclass),
  request_id integer,
  item_name text NOT NULL,
  quantity integer NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  requested_item_id smallint,
  CONSTRAINT warehouse_supply_items_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_supply_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id)
);

CREATE TABLE IF NOT EXISTS public.warehouse_supply_templates (
  id bigint NOT NULL DEFAULT nextval('warehouse_supply_templates_id_seq'::regclass),
  template_name text NOT NULL UNIQUE,
  items jsonb NOT NULL,
  inserted_at timestamp with time zone DEFAULT now(),
  department_id integer,
  CONSTRAINT warehouse_supply_templates_pkey PRIMARY KEY (id),
  CONSTRAINT warehouse_supply_templates_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id)
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id integer NOT NULL DEFAULT nextval('warehouses_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'warehouse'::text,
  location text,
  description text,
  department_id integer UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_pkey PRIMARY KEY (id),
  CONSTRAINT warehouses_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id)
);

COMMIT;