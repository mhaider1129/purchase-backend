-- MANUAL DATABASE MIGRATION REQUIRED.
-- Run this ENTIRE file in Supabase SQL Editor, not a selected column fragment.
-- Older supplier creation code omitted the institute scope used by SQL 035 and
-- surgical consignments. Preserve existing ownership; never infer a hospital.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.suppliers') IS NULL OR to_regclass('public.institutes') IS NULL THEN
    RAISE EXCEPTION 'Existing public.suppliers and public.institutes are required; restore the application foundation first';
  END IF;
END $$;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS institute_id integer;

DO $$
DECLARE scope_att smallint; institute_att smallint;
BEGIN
  SELECT attnum INTO scope_att FROM pg_attribute
    WHERE attrelid='public.suppliers'::regclass AND attname='institute_id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.suppliers'::regclass
      AND attnum=scope_att AND atttypid IN ('integer'::regtype,'bigint'::regtype)) THEN
    RAISE EXCEPTION 'public.suppliers.institute_id has an incompatible type; reconcile it explicitly without discarding existing values';
  END IF;
  SELECT attnum INTO institute_att FROM pg_attribute
    WHERE attrelid='public.institutes'::regclass AND attname='id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.suppliers'::regclass AND contype='f'
      AND conkey=ARRAY[scope_att] AND confrelid='public.institutes'::regclass
      AND confkey=ARRAY[institute_att]) THEN
    -- Check future writes without deleting/rewriting legacy data. Any pre-existing
    -- orphan ownership values need separate review, not an inferred replacement.
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_consignment_institute_scope_fkey
      FOREIGN KEY(institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS suppliers_institute_scope_idx ON public.suppliers(institute_id);
COMMIT;

-- Verification only. NULL ownership retains the legacy shared supplier directory
-- semantics already supported by the backend; no supplier is reassigned here.
SELECT count(*) AS total_suppliers,
       count(*) FILTER (WHERE institute_id IS NULL) AS shared_suppliers,
       count(*) FILTER (WHERE institute_id IS NOT NULL) AS institute_scoped_suppliers
FROM public.suppliers;

-- Must return zero rows for the institute-scope prerequisites. If another table
-- is listed, restore that existing foundation through schema reconciliation.
SELECT required.table_name,required.column_name AS missing_column
FROM (VALUES ('surgical_consignment_cases','institute_id'),('departments','institute_id'),
  ('users','institute_id'),('suppliers','institute_id'),
  ('organization_units','institute_id'),('requests','institute_id')) required(table_name,column_name)
LEFT JOIN information_schema.columns actual ON actual.table_schema='public'
  AND actual.table_name=required.table_name AND actual.column_name=required.column_name
WHERE actual.column_name IS NULL ORDER BY required.table_name;
