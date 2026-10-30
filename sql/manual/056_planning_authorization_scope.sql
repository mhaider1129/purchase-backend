-- MANUAL DATABASE MIGRATION REQUIRED. Do not execute through application startup.
-- Apply the complete file manually in Development first, validate, then schedule
-- Production separately. This patch has NOT been executed by Codex.
-- Adds planning permissions and institute-owned defaults. Existing unowned
-- global defaults remain preserved, unassigned and inaccessible to new reads.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.permissions') IS NULL OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.data_scopes') IS NULL THEN
    RAISE EXCEPTION 'Established permission/role/audit schema is required';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.planning_settings (
  id BIGSERIAL PRIMARY KEY, warehouse_id BIGINT,
  forecast_horizon_months INTEGER NOT NULL DEFAULT 6,
  forecast_window_size INTEGER NOT NULL DEFAULT 3,
  safety_lead_time_days INTEGER NOT NULL DEFAULT 14,
  safety_review_period_days INTEGER NOT NULL DEFAULT 7,
  demand_history_days INTEGER NOT NULL DEFAULT 120,
  demand_history_months INTEGER NOT NULL DEFAULT 12,
  safety_history_days INTEGER NOT NULL DEFAULT 180,
  mrp_horizon_days INTEGER NOT NULL DEFAULT 84,
  mrp_bucket_days INTEGER NOT NULL DEFAULT 7,
  updated_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ALTER TABLE acquires a table lock. Run during a planned maintenance window.
ALTER TABLE public.planning_settings ADD COLUMN IF NOT EXISTS institute_id INTEGER;
LOCK TABLE public.planning_settings IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.planning_settings'::regclass AND conname='planning_settings_institute_fk') THEN
    ALTER TABLE public.planning_settings ADD CONSTRAINT planning_settings_institute_fk FOREIGN KEY(institute_id) REFERENCES public.institutes(id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.planning_settings p JOIN public.warehouses w ON w.id=p.warehouse_id WHERE p.institute_id IS NOT NULL AND p.institute_id IS DISTINCT FROM w.institute_id) THEN
    RAISE EXCEPTION 'Conflicting planning/warehouse ownership requires explicit reconciliation';
  END IF;
END $$;
-- Deterministic warehouse provenance only. Never infer ownership of the old
-- global row from an importer's current department or a guessed institute ID.
WITH changed AS (
  UPDATE public.planning_settings p SET institute_id=w.institute_id
  FROM public.warehouses w LEFT JOIN public.departments d ON d.id=w.department_id
  WHERE p.warehouse_id=w.id AND p.institute_id IS NULL AND w.institute_id IS NOT NULL
    AND (w.department_id IS NULL OR d.institute_id=w.institute_id)
  RETURNING p.*
)
INSERT INTO public.audit_logs(action,action_type,target_type,target_id,description)
SELECT 'planning.defaults.ownership_bound','planning.defaults.ownership_bound','planning_settings',id,
  'SQL 056: bind defaults to explicit warehouse institute; ' || jsonb_build_object('afterData',to_jsonb(changed),'databaseRole',current_user)::text
FROM changed;
-- The legacy warehouse-only key prevents two institutes storing their own
-- global defaults. Replace that index, not any table or historical data.
DROP INDEX IF EXISTS public.planning_settings_warehouse_key;
CREATE UNIQUE INDEX IF NOT EXISTS planning_settings_institute_warehouse_key
  ON public.planning_settings(institute_id,(COALESCE(warehouse_id,-1)))
  WHERE institute_id IS NOT NULL;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid='public.planning_settings_institute_warehouse_key'::regclass
    AND (i.indrelid<>'public.planning_settings'::regclass OR NOT i.indisunique OR NOT i.indisvalid OR i.indnkeyatts<>2
      OR pg_get_indexdef(i.indexrelid,1,true) IS DISTINCT FROM 'institute_id'
      OR pg_get_indexdef(i.indexrelid,2,true) !~* 'COALESCE\(warehouse_id,.*-1([^0-9]|$)'
      OR pg_get_expr(i.indpred,i.indrelid) IS DISTINCT FROM '(institute_id IS NOT NULL)')) THEN
    RAISE EXCEPTION 'Planning defaults ownership index has an incompatible definition; reconcile it explicitly';
  END IF;
END $$;

WITH definitions(code,name,description) AS (VALUES
 ('planning.view','View procurement planning','Read planning and advisory results within authorized institute, department and warehouse scopes.'),
 ('planning.manage','Prepare procurement plans','Maintain plan files, items, source links and defaults within authorized scopes. No approval or procurement posting authority.'),
 ('replenishment.manage','Manage replenishment configuration','Maintain scoped policies and generate advisory tasks. No inventory or procurement posting authority.'),
 ('planning.cross-department','Plan across departments','Extend an existing planning capability across departments of the current institute only.'),
 ('planning.cross-warehouse','Plan across warehouses','Extend an existing planning capability across warehouses of the current institute only.')
), inserted AS (
 INSERT INTO public.permissions(code,name,description)
 SELECT code,name,description FROM definitions ON CONFLICT(code) DO NOTHING RETURNING *
)
INSERT INTO public.audit_logs(action,action_type,target_type,target_id,description)
SELECT 'planning.permission.registered','planning.permission.registered','permission',id,
 'SQL 056: register explicit planning capability; ' || jsonb_build_object('afterData',to_jsonb(inserted),'databaseRole',current_user)::text FROM inserted;

-- Preserve normal SCM operations with explicit grants, not a runtime role bypass.
-- A procurement specialist prepares in own/assigned scopes. Warehouse managers
-- view and manage replenishment in their actual warehouse/department assignment.
WITH grants AS (
 INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
 WHERE (lower(regexp_replace(btrim(r.name),'[[:space:]_]+','','g'))='scm'
          AND p.code IN ('planning.view','planning.manage','replenishment.manage','planning.cross-department','planning.cross-warehouse'))
    OR (lower(regexp_replace(btrim(r.name),'[[:space:]_]+','','g'))='procurementspecialist' AND p.code IN ('planning.view','planning.manage'))
    OR (lower(regexp_replace(btrim(r.name),'[[:space:]_]+','','g'))='warehousemanager' AND p.code IN ('planning.view','replenishment.manage'))
 ON CONFLICT DO NOTHING RETURNING *
)
INSERT INTO public.audit_logs(action,action_type,target_type,target_id,description)
SELECT 'planning.role.permission_granted','planning.role.permission_granted','role',role_id,
 'SQL 056: established operational planning grant; ' || jsonb_build_object('afterData',to_jsonb(grants),'databaseRole',current_user)::text FROM grants;
-- Existing plan-child schema moves out of request-time DDL. These definitions
-- preserve the legacy model and only create genuinely missing tables/indexes.
CREATE TABLE IF NOT EXISTS public.procurement_plan_items (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES procurement_plans(id) ON DELETE CASCADE,
          stock_item_id INTEGER REFERENCES stock_items(id),
          item_name TEXT NOT NULL,
          description TEXT,
          unit_of_measure TEXT,
          planned_quantity NUMERIC NOT NULL,
          planned_unit_cost NUMERIC,
          planned_total_cost NUMERIC,
          currency TEXT,
          needed_by_date DATE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE IF NOT EXISTS public.procurement_plan_item_requests (
          id SERIAL PRIMARY KEY,
          plan_item_id INTEGER NOT NULL REFERENCES procurement_plan_items(id) ON DELETE CASCADE,
          request_id INTEGER REFERENCES requests(id),
          requested_item_id INTEGER REFERENCES requested_items(id),
          quantity NUMERIC NOT NULL,
          unit_cost NUMERIC,
          total_cost NUMERIC,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (plan_item_id, requested_item_id)
        );
CREATE TABLE IF NOT EXISTS public.procurement_plan_item_consumptions (
          id SERIAL PRIMARY KEY,
          plan_item_id INTEGER NOT NULL REFERENCES procurement_plan_items(id) ON DELETE CASCADE,
          warehouse_stock_movement_id INTEGER REFERENCES warehouse_stock_movements(id),
          department_stock_movement_id INTEGER REFERENCES department_stock_movements(id),
          quantity NUMERIC NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          CHECK (warehouse_stock_movement_id IS NOT NULL OR department_stock_movement_id IS NOT NULL),
          UNIQUE (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id)
        );
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON public.procurement_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_item_requests_item ON public.procurement_plan_item_requests(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_plan_item_consumptions_item ON public.procurement_plan_item_consumptions(plan_item_id);

-- Additional departmental planners/viewers are granted explicitly through the
-- existing Management permissions and data-scopes UI. No user ID is hardcoded.
-- Existing data-scopes use arbitrary registered codes; add bounded ID scopes.
INSERT INTO public.data_scopes(code,name,description) VALUES
 ('department_ids','Authorized department IDs','Explicit department IDs within the actor institute; no cross-institute authority.'),
 ('warehouse_ids','Authorized warehouse IDs','Explicit warehouse IDs within the actor institute; no cross-institute authority.')
ON CONFLICT(code) DO NOTHING;

-- Existing shared procurement UI policy is preserved. The application registers
-- new planning-specific UI resources through its established resource catalog.
COMMIT;
