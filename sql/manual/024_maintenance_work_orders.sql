-- 024: Maintenance execution linking Equipment, Contract coverage and Spare Parts.
-- FORWARD-ONLY. Run manually after 019, 021 and 023.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.maintainable_equipment') IS NULL OR to_regclass('public.approved_spare_parts') IS NULL
     OR to_regclass('public.contract_equipment_coverage') IS NULL OR to_regclass('public.stock_items') IS NULL THEN
    RAISE EXCEPTION 'SQL_024_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  IF to_regclass('public.maintenance_work_orders') IS NOT NULL OR to_regclass('public.maintenance_work_order_parts') IS NOT NULL THEN
    IF to_regclass('public.maintenance_work_orders') IS NOT NULL AND to_regclass('public.maintenance_work_order_parts') IS NOT NULL
       AND to_regclass('public.maintenance_work_orders_status_idx') IS NOT NULL THEN
      RAISE NOTICE 'SQL_024_ALREADY_APPLIED_COMPATIBLE'; RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_024_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  ALTER TABLE public.approved_spare_parts ADD CONSTRAINT approved_spare_parts_institute_id_id_uq UNIQUE(institute_id,id);
  ALTER TABLE public.contract_equipment_coverage ADD CONSTRAINT contract_equipment_coverage_institute_id_id_equipment_uq UNIQUE(institute_id,id,equipment_id);
  CREATE TABLE public.maintenance_work_order_allocators (
    institute_id integer PRIMARY KEY REFERENCES public.institutes(id) ON DELETE RESTRICT,
    next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0)
  );
  CREATE FUNCTION public.next_maintenance_work_order_number(p_institute_id integer) RETURNS text
  LANGUAGE plpgsql AS $fn$ DECLARE n bigint; BEGIN
    INSERT INTO public.maintenance_work_order_allocators(institute_id,next_value) VALUES(p_institute_id,2)
    ON CONFLICT(institute_id) DO UPDATE SET next_value=maintenance_work_order_allocators.next_value+1
    RETURNING next_value-1 INTO n;
    RETURN 'MWO-'||p_institute_id||'-'||lpad(n::text,6,'0');
  END $fn$;

  CREATE TABLE public.maintenance_work_orders (
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES public.institutes(id),
    work_order_number text NOT NULL,equipment_id bigint NOT NULL,coverage_id bigint,
    work_order_type text NOT NULL CHECK(work_order_type IN('CORRECTIVE','PREVENTIVE','CALIBRATION','INSPECTION','INSTALLATION','OTHER')),
    priority text NOT NULL CHECK(priority IN('CRITICAL','HIGH','MEDIUM','LOW')),
    status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED')),
    problem_description text NOT NULL,failure_code text,resolution_summary text,
    requested_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,
    downtime_started_at timestamptz,downtime_ended_at timestamptz,assigned_to integer REFERENCES public.users(id),
    created_by integer NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now(),
    updated_by integer NOT NULL REFERENCES public.users(id),updated_at timestamptz NOT NULL DEFAULT now(),row_version bigint NOT NULL DEFAULT 1,
    FOREIGN KEY(institute_id,equipment_id) REFERENCES public.maintainable_equipment(institute_id,id) ON DELETE RESTRICT,
    FOREIGN KEY(institute_id,coverage_id,equipment_id) REFERENCES public.contract_equipment_coverage(institute_id,id,equipment_id) ON DELETE RESTRICT,
    CHECK(completed_at IS NULL OR started_at IS NULL OR completed_at>=started_at),
    CHECK(downtime_ended_at IS NULL OR downtime_started_at IS NULL OR downtime_ended_at>=downtime_started_at),
    UNIQUE(institute_id,work_order_number),UNIQUE(institute_id,id)
  );
  CREATE INDEX maintenance_work_orders_status_idx ON public.maintenance_work_orders(institute_id,status,priority,requested_at DESC);
  CREATE INDEX maintenance_work_orders_equipment_idx ON public.maintenance_work_orders(institute_id,equipment_id,requested_at DESC);

  CREATE TABLE public.maintenance_work_order_parts (
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES public.institutes(id),work_order_id bigint NOT NULL,
    spare_part_id bigint NOT NULL,stock_item_id integer NOT NULL REFERENCES public.stock_items(id) ON DELETE RESTRICT,
    quantity_planned numeric(18,6) NOT NULL CHECK(quantity_planned>0),quantity_used numeric(18,6) NOT NULL DEFAULT 0 CHECK(quantity_used>=0),
    action text NOT NULL DEFAULT 'PLANNED' CHECK(action IN('PLANNED','RESERVED','ISSUED','INSTALLED','REMOVED','RETURNED_UNUSED','RETURNED_FOR_REPAIR','SCRAPPED')),
    installed_serial_number text,removed_serial_number text,notes text,
    created_by integer NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(institute_id,work_order_id) REFERENCES public.maintenance_work_orders(institute_id,id) ON DELETE CASCADE,
    FOREIGN KEY(institute_id,spare_part_id) REFERENCES public.approved_spare_parts(institute_id,id) ON DELETE RESTRICT,
    CHECK(quantity_used<=quantity_planned OR action IN('REMOVED','RETURNED_FOR_REPAIR','SCRAPPED'))
  );
  CREATE INDEX maintenance_work_order_parts_work_order_idx ON public.maintenance_work_order_parts(work_order_id,action);

  INSERT INTO public.permissions(code,name,description) VALUES
    ('maintenance.view','View maintenance work orders','View institute-scoped Equipment maintenance history'),
    ('maintenance.manage','Manage maintenance work orders','Create and progress Equipment maintenance work orders')
  ON CONFLICT(code) DO NOTHING;
  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT rp.role_id,target.id FROM public.role_permissions rp JOIN public.permissions source ON source.id=rp.permission_id
  JOIN public.permissions target ON target.code='maintenance.view' WHERE source.code='equipment.view' ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT rp.role_id,target.id FROM public.role_permissions rp JOIN public.permissions source ON source.id=rp.permission_id
  JOIN public.permissions target ON target.code='maintenance.manage' WHERE source.code='equipment.manage' ON CONFLICT DO NOTHING;
END $migration$;
COMMIT;