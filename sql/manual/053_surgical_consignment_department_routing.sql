-- MANUAL DATABASE MIGRATION REQUIRED. Run this entire file in Supabase SQL Editor.
-- Existing consignment records, signatures and commercial terms are preserved.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.surgical_consignment_cases') IS NULL THEN
  RAISE EXCEPTION 'Apply complete SQL 051 before SQL 053';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.surgical_consignment_department_settings (
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 department_id integer NOT NULL REFERENCES public.departments(id),
 is_enabled boolean NOT NULL DEFAULT false,
 nurse_id integer REFERENCES public.users(id),
 warehouse_id integer REFERENCES public.warehouses(id),
 receiver_id integer REFERENCES public.users(id),
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 updated_by integer NOT NULL REFERENCES public.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(institute_id,department_id),
 CHECK(NOT is_enabled OR (nurse_id IS NOT NULL AND warehouse_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_section_nurses (
 institute_id integer NOT NULL,
 department_id integer NOT NULL,
 section_id integer NOT NULL REFERENCES public.sections(id),
 nurse_id integer NOT NULL REFERENCES public.users(id),
 PRIMARY KEY(institute_id,department_id,section_id),
 FOREIGN KEY(institute_id,department_id) REFERENCES public.surgical_consignment_department_settings(institute_id,department_id)
);
ALTER TABLE public.surgical_consignment_department_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surgical_consignment_section_nurses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.surgical_consignment_department_settings,public.surgical_consignment_section_nurses FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.surgical_consignment_department_settings, public.surgical_consignment_section_nurses FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
ALTER TABLE public.surgical_consignment_cases ADD COLUMN IF NOT EXISTS recommended_vendor text NOT NULL DEFAULT '';
ALTER TABLE public.surgical_consignment_cases ADD COLUMN IF NOT EXISTS surgery_section_id integer REFERENCES public.sections(id);
ALTER TABLE public.surgical_consignment_cases ADD COLUMN IF NOT EXISTS receiving_warehouse_id integer REFERENCES public.warehouses(id);
ALTER TABLE public.surgical_consignment_cases ADD COLUMN IF NOT EXISTS routing_snapshot jsonb;
-- Surgeons request clinical need before SCM selects a supplier and agrees terms.
ALTER TABLE public.surgical_consignment_cases ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE public.surgical_consignment_cases ALTER COLUMN supplier_name DROP NOT NULL;
ALTER TABLE public.surgical_consignment_cases ALTER COLUMN vendor_contact DROP NOT NULL;
ALTER TABLE public.surgical_consignment_cases ALTER COLUMN agreement_reference DROP NOT NULL;
COMMIT;
