-- MANUAL DATABASE MIGRATION REQUIRED. Run this entire file in Supabase SQL Editor.
-- Original shared supplier and Item Master schemas can omit institute_id.
-- NULL retains shared ownership; never guess ownership or rewrite existing values.
BEGIN;
DO $$
DECLARE target text; scope_att smallint; institute_att smallint;
BEGIN
 IF to_regclass('public.institutes') IS NULL THEN
  RAISE EXCEPTION 'Restore the institutes foundation before SQL 055';
 END IF;
 SELECT attnum INTO institute_att FROM pg_attribute WHERE attrelid='public.institutes'::regclass AND attname='id' AND NOT attisdropped;
 FOREACH target IN ARRAY ARRAY['suppliers','approved_products'] LOOP
  IF to_regclass('public.'||target) IS NULL THEN
   RAISE EXCEPTION 'Restore public.% through the application foundation before SQL 055',target;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS institute_id integer',target);
  SELECT attnum INTO scope_att FROM pg_attribute WHERE attrelid=to_regclass('public.'||target) AND attname='institute_id' AND NOT attisdropped;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||target) AND attnum=scope_att AND atttypid IN ('integer'::regtype,'bigint'::regtype)) THEN
   RAISE EXCEPTION 'public.%.institute_id has an incompatible type; reconcile explicitly without discarding values',target;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||target) AND contype='f' AND conkey=ARRAY[scope_att] AND confrelid='public.institutes'::regclass AND confkey=ARRAY[institute_att]) THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(institute_id) REFERENCES public.institutes(id) ON DELETE RESTRICT NOT VALID',target,target||'_technical_institute_scope_fkey');
  END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(institute_id)',target||'_technical_institute_scope_idx',target);
 END LOOP;
END $$;
COMMIT;

-- Verification: both rows should be present. No data, policies or grants changed.
SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('suppliers','approved_products')
AND column_name='institute_id' ORDER BY table_name;
