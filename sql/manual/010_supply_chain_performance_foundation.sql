-- MANUAL MIGRATION 010: Supply Chain Performance & Workload foundation
-- Review and execute manually. This migration intentionally does not alter 009.
BEGIN;

-- Fail closed before any DDL or catalog data is changed. A populated SQL 010
-- namespace must be either the complete contract below or rejected for operator review.
DO $$
DECLARE
  missing_prerequisites text;
  existing_objects integer;
  mismatches text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO missing_prerequisites
  FROM (VALUES ('requests'),('requested_items'),('institutes'),('users'),('departments'),('suppliers'),('audit_logs'),('permissions')) required(name)
  WHERE to_regclass('public.' || name) IS NULL;
  IF missing_prerequisites IS NOT NULL THEN
    RAISE EXCEPTION '010 preflight missing: %', missing_prerequisites;
  END IF;

  SELECT count(*) INTO existing_objects FROM (
    SELECT to_regclass('public.' || name) object_id
    FROM (VALUES ('procurement_cases'),('procurement_case_activities'),('procurement_case_complexity_factors'),('procurement_value_events'),
                 ('procurement_cases_one_active_item_uq'),('procurement_cases_scope_idx'),('procurement_cases_pipeline_idx'),
                 ('procurement_case_activities_idempotency_uq'),('procurement_case_activities_timeline_idx'),
                 ('procurement_case_activities_supplier_idx'),('procurement_value_events_case_currency_idx')) objects(name)
  ) found WHERE object_id IS NOT NULL;

  IF existing_objects = 0 THEN RETURN; END IF;

  WITH required_columns(table_name, column_name) AS (VALUES
    ('procurement_cases','id'),('procurement_cases','request_id'),('procurement_cases','requested_item_id'),
    ('procurement_cases','institute_id'),('procurement_cases','department_id'),('procurement_cases','assigned_buyer_id'),
    ('procurement_cases','case_status'),('procurement_cases','pending_root_cause'),('procurement_cases','opened_at'),
    ('procurement_cases','closed_at'),('procurement_cases','complexity_score'),('procurement_cases','complexity_class'),
    ('procurement_cases','complexity_model_version'),('procurement_cases','workload_units'),('procurement_cases','workload_model_version'),
    ('procurement_cases','activity_coverage'),('procurement_cases','complexity_coverage'),('procurement_cases','commercial_coverage'),
    ('procurement_cases','cycle_time_coverage'),('procurement_cases','logistics_coverage'),
    ('procurement_case_activities','id'),('procurement_case_activities','procurement_case_id'),
    ('procurement_case_activities','activity_type'),('procurement_case_activities','activity_at'),
    ('procurement_case_activities','actor_id'),('procurement_case_activities','supplier_id'),
    ('procurement_case_activities','source'),('procurement_case_activities','idempotency_key'),('procurement_case_activities','metadata'),
    ('procurement_case_complexity_factors','id'),('procurement_case_complexity_factors','procurement_case_id'),
    ('procurement_case_complexity_factors','model_version'),('procurement_case_complexity_factors','factor_code'),
    ('procurement_case_complexity_factors','factor_value'),('procurement_case_complexity_factors','points'),
    ('procurement_case_complexity_factors','assessed_by'),('procurement_case_complexity_factors','assessment_reason'),
    ('procurement_value_events','id'),('procurement_value_events','procurement_case_id'),
    ('procurement_value_events','value_type'),('procurement_value_events','baseline_type'),
    ('procurement_value_events','verified_value'),('procurement_value_events','currency'),
    ('procurement_value_events','evidence_entity_type'),('procurement_value_events','evidence_entity_id'),
    ('procurement_value_events','entered_by'),('procurement_value_events','verified_by'),('procurement_value_events','verified_at')
  ), required_indexes(name, required_definition) AS (VALUES
    ('procurement_cases_one_active_item_uq','UNIQUE INDEX procurement_cases_one_active_item_uq%ON public.procurement_cases USING btree (requested_item_id) WHERE (closed_at IS NULL)'),
    ('procurement_cases_scope_idx','INDEX procurement_cases_scope_idx%ON public.procurement_cases USING btree (institute_id, department_id, assigned_buyer_id, opened_at)'),
    ('procurement_cases_pipeline_idx','INDEX procurement_cases_pipeline_idx%ON public.procurement_cases USING btree (case_status, pending_root_cause) WHERE (closed_at IS NULL)'),
    ('procurement_case_activities_idempotency_uq','UNIQUE INDEX procurement_case_activities_idempotency_uq%ON public.procurement_case_activities USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)'),
    ('procurement_case_activities_timeline_idx','INDEX procurement_case_activities_timeline_idx%ON public.procurement_case_activities USING btree (procurement_case_id, activity_at DESC)'),
    ('procurement_case_activities_supplier_idx','INDEX procurement_case_activities_supplier_idx%ON public.procurement_case_activities USING btree (supplier_id, activity_type) WHERE (supplier_id IS NOT NULL)'),
    ('procurement_value_events_case_currency_idx','INDEX procurement_value_events_case_currency_idx%ON public.procurement_value_events USING btree (procurement_case_id, value_type, currency)')
  ), required_fks(table_name, column_name) AS (VALUES
    ('procurement_cases','request_id'),('procurement_cases','requested_item_id'),('procurement_cases','institute_id'),
    ('procurement_cases','department_id'),('procurement_cases','assigned_buyer_id'),
    ('procurement_case_activities','procurement_case_id'),('procurement_case_activities','actor_id'),
    ('procurement_case_activities','supplier_id'),('procurement_case_complexity_factors','procurement_case_id'),
    ('procurement_case_complexity_factors','assessed_by'),('procurement_value_events','procurement_case_id'),
    ('procurement_value_events','entered_by'),('procurement_value_events','verified_by')
  ), problems AS (
    SELECT 'missing column public.' || r.table_name || '.' || r.column_name detail
    FROM required_columns r LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
    WHERE c.column_name IS NULL
    UNION ALL
    SELECT 'missing/mismatched index public.' || r.name FROM required_indexes r
    WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname='public' AND i.indexname=r.name
                      AND i.indexdef LIKE r.required_definition)
    UNION ALL
    SELECT 'missing FK on public.' || r.table_name || '.' || r.column_name
    FROM required_fks r WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
      JOIN unnest(con.conkey) key(attnum) ON true JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=key.attnum
      WHERE con.contype='f' AND n.nspname='public' AND rel.relname=r.table_name AND a.attname=r.column_name)
    UNION ALL
    SELECT 'insufficient CHECK constraints on public.' || expected.table_name
    FROM (VALUES ('procurement_cases',7),('procurement_case_activities',2),('procurement_case_complexity_factors',1),('procurement_value_events',4)) expected(table_name, minimum_count)
    WHERE (SELECT count(*) FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
           JOIN pg_namespace n ON n.oid=rel.relnamespace
           WHERE con.contype='c' AND n.nspname='public' AND rel.relname=expected.table_name) < expected.minimum_count
    UNION ALL
    SELECT 'missing permission ' || required.code FROM (VALUES
      ('procurement-performance.view'),('procurement-performance.manage'),('procurement-performance.verify-savings'),
      ('procurement-performance.view-executive'),('procurement-performance.manage-highlights')) required(code)
    WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code=required.code)
  )
  SELECT string_agg(detail, '; ' ORDER BY detail) INTO mismatches FROM problems;

  IF mismatches IS NULL THEN
    RAISE EXCEPTION 'SQL_010_ALREADY_APPLIED';
  END IF;
  RAISE EXCEPTION 'SQL_010_PARTIAL_OR_DRIFTED_SCHEMA: %', mismatches;
END $$;

CREATE TABLE public.procurement_cases (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.requests(id),
  requested_item_id INTEGER NOT NULL REFERENCES public.requested_items(id),
  institute_id INTEGER NOT NULL REFERENCES public.institutes(id),
  department_id INTEGER REFERENCES public.departments(id),
  assigned_buyer_id INTEGER REFERENCES public.users(id),
  case_status TEXT NOT NULL CHECK (case_status IN ('APPROVAL_PENDING','ITEM_IDENTITY_RESOLUTION','READY_FOR_SOURCING','SOURCING','AWAITING_QUOTATION','TECHNICAL_EVALUATION','COMMERCIAL_EVALUATION','AWARDED','PO_PROCESSING','SUPPLIER_FULFILLMENT','LOGISTICS','DELIVERED','CLOSED')),
  sourcing_method TEXT,
  pending_root_cause TEXT CHECK (pending_root_cause IS NULL OR pending_root_cause IN ('ITEM_IDENTITY_RESOLUTION','SUPPLY_CHAIN_SOURCING','AWAITING_TECHNICAL_EVALUATION','AWAITING_SUPPLIER_QUOTATION','AWAITING_FINANCE_PAYMENT','SUPPLIER_MANUFACTURING','INTERNATIONAL_SHIPMENT','CUSTOMS_REGULATORY','END_USER_CLARIFICATION','APPROVAL_PENDING','OTHER')),
  pending_override_reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), assigned_at TIMESTAMPTZ,
  sourcing_started_at TIMESTAMPTZ, commercially_ready_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  complexity_score SMALLINT CHECK (complexity_score BETWEEN 1 AND 100),
  complexity_class CHAR(1) CHECK (complexity_class IN ('A','B','C','D','E')),
  complexity_model_version TEXT,
  workload_units SMALLINT CHECK (workload_units IN (1,2,4,7,10)),
  workload_model_version TEXT,
  existing_supplier BOOLEAN, sole_source BOOLEAN, oem_only BOOLEAN,
  international_procurement BOOLEAN, discontinued_or_obsolete BOOLEAN,
  alternative_product_investigated BOOLEAN,
  strategic_highlight BOOLEAN NOT NULL DEFAULT false,
  strategic_summary JSONB,
  activity_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (activity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  complexity_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (complexity_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  commercial_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (commercial_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  cycle_time_coverage TEXT NOT NULL DEFAULT 'PARTIAL' CHECK (cycle_time_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  logistics_coverage TEXT NOT NULL DEFAULT 'MISSING' CHECK (logistics_coverage IN ('FULL','PARTIAL','MISSING','LEGACY_INCOMPLETE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by INTEGER REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by INTEGER REFERENCES public.users(id),
  CHECK ((complexity_score IS NULL AND complexity_class IS NULL AND complexity_model_version IS NULL AND workload_units IS NULL) OR
         (complexity_score IS NOT NULL AND complexity_class IS NOT NULL AND complexity_model_version IS NOT NULL AND workload_units IS NOT NULL)),
  CHECK (pending_override_reason IS NULL OR pending_root_cause IS NOT NULL)
);
CREATE UNIQUE INDEX procurement_cases_one_active_item_uq ON public.procurement_cases(requested_item_id) WHERE closed_at IS NULL;
CREATE INDEX procurement_cases_scope_idx ON public.procurement_cases(institute_id, department_id, assigned_buyer_id, opened_at);
CREATE INDEX procurement_cases_pipeline_idx ON public.procurement_cases(case_status, pending_root_cause) WHERE closed_at IS NULL;

CREATE TABLE public.procurement_case_activities (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL REFERENCES public.procurement_cases(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  activity_at TIMESTAMPTZ NOT NULL,
  actor_id INTEGER REFERENCES public.users(id), supplier_id INTEGER REFERENCES public.suppliers(id),
  related_entity_type TEXT, related_entity_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('SYSTEM','MANUAL','OUTBOX','LEGACY')),
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source <> 'MANUAL' OR (actor_id IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes)) > 0))
);
CREATE UNIQUE INDEX procurement_case_activities_idempotency_uq ON public.procurement_case_activities(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX procurement_case_activities_timeline_idx ON public.procurement_case_activities(procurement_case_id, activity_at DESC);
CREATE INDEX procurement_case_activities_supplier_idx ON public.procurement_case_activities(supplier_id, activity_type) WHERE supplier_id IS NOT NULL;

CREATE TABLE public.procurement_case_complexity_factors (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL REFERENCES public.procurement_cases(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL, factor_code TEXT NOT NULL, factor_value TEXT NOT NULL,
  points SMALLINT NOT NULL CHECK (points BETWEEN 1 AND 10),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(), assessed_by INTEGER NOT NULL REFERENCES public.users(id),
  assessment_reason TEXT NOT NULL,
  UNIQUE(procurement_case_id, model_version, factor_code)
);

CREATE TABLE public.procurement_value_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  procurement_case_id BIGINT NOT NULL REFERENCES public.procurement_cases(id) ON DELETE RESTRICT,
  value_type TEXT NOT NULL CHECK (value_type IN ('HARD_SAVINGS','COST_AVOIDANCE')),
  baseline_type TEXT NOT NULL, baseline_amount NUMERIC(20,4), final_amount NUMERIC(20,4),
  verified_value NUMERIC(20,4) NOT NULL CHECK (verified_value >= 0), currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_entity_type TEXT NOT NULL, evidence_entity_id TEXT NOT NULL, notes TEXT,
  entered_by INTEGER NOT NULL REFERENCES public.users(id), verified_by INTEGER REFERENCES public.users(id), verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((value_type = 'HARD_SAVINGS' AND baseline_amount IS NOT NULL AND final_amount IS NOT NULL AND baseline_amount >= final_amount AND verified_value = baseline_amount - final_amount AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
      OR (value_type = 'COST_AVOIDANCE' AND verified_value >= 0 AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes)) > 0))
);
CREATE INDEX procurement_value_events_case_currency_idx ON public.procurement_value_events(procurement_case_id, value_type, currency);

-- Permission catalog only; no role grants are made by this migration.
INSERT INTO public.permissions (code, name, description)
VALUES
 ('procurement-performance.view','View procurement performance','View scoped procurement cases and metrics'),
 ('procurement-performance.manage','Manage procurement performance','Record governed case facts and manual activities'),
 ('procurement-performance.verify-savings','Verify procurement savings','Verify evidence-backed hard savings'),
 ('procurement-performance.view-executive','View executive procurement performance','View executive aggregate reporting'),
 ('procurement-performance.manage-highlights','Manage strategic case highlights','Manage evidence-linked strategic highlights')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description;

DO $$ BEGIN
  IF to_regclass('public.procurement_cases') IS NULL OR to_regclass('public.procurement_case_activities') IS NULL
     OR to_regclass('public.procurement_case_complexity_factors') IS NULL OR to_regclass('public.procurement_value_events') IS NULL
  THEN RAISE EXCEPTION '010 postflight failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='procurement_cases_one_active_item_uq')
  THEN RAISE EXCEPTION '010 active case uniqueness missing'; END IF;
END $$;
COMMIT;