-- 021: Effective-dated Contract coverage for maintainable Equipment.
-- FORWARD-ONLY. Run manually after 019 and 020; never from application startup.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.contracts') IS NULL OR to_regclass('public.maintainable_equipment') IS NULL
     OR to_regclass('public.institutes') IS NULL OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'SQL_021_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  IF to_regclass('public.contract_equipment_coverage') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contract_equipment_coverage' AND column_name='institute_id' AND is_nullable='NO')
       AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_equipment_coverage'::regclass AND conname='contract_equipment_coverage_equipment_scope_fk')
       AND to_regclass('public.contract_equipment_coverage_equipment_dates_idx') IS NOT NULL THEN
      RAISE NOTICE 'SQL_021_ALREADY_APPLIED_COMPATIBLE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_021_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  ALTER TABLE public.maintainable_equipment
    ADD CONSTRAINT maintainable_equipment_institute_id_id_uq UNIQUE (institute_id,id);

  CREATE TABLE public.contract_equipment_coverage (
    id bigserial PRIMARY KEY,
    institute_id integer NOT NULL REFERENCES public.institutes(id) ON DELETE RESTRICT,
    contract_id integer NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
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
    created_by integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_equipment_coverage_equipment_scope_fk FOREIGN KEY (institute_id,equipment_id)
      REFERENCES public.maintainable_equipment(institute_id,id) ON DELETE RESTRICT,
    CONSTRAINT contract_equipment_coverage_dates_ck CHECK (coverage_end >= coverage_start),
    CONSTRAINT contract_equipment_coverage_sla_ck CHECK (
      (response_time_hours IS NULL OR response_time_hours >= 0) AND
      (resolution_time_hours IS NULL OR resolution_time_hours >= 0) AND
      (uptime_target_percent IS NULL OR uptime_target_percent BETWEEN 0 AND 100) AND
      (coverage_limit IS NULL OR coverage_limit >= 0)
    ),
    UNIQUE (contract_id,equipment_id,coverage_start,coverage_type)
  );
  CREATE INDEX contract_equipment_coverage_equipment_dates_idx
    ON public.contract_equipment_coverage(institute_id,equipment_id,coverage_start,coverage_end);
  CREATE INDEX contract_equipment_coverage_contract_idx
    ON public.contract_equipment_coverage(contract_id,equipment_id);
END $migration$;

COMMIT;