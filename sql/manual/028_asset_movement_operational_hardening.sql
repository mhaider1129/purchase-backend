-- 028: Enforce one active movement and link canonical return movements.
-- MANUAL/PENDING. Run after 017; never from application startup.
-- Absent installs, complete-compatible notices/no-ops, and partial/drifted fails closed.
BEGIN;

DO $migration$
DECLARE
  target_count integer;
  compatible boolean;
BEGIN
  -- SQL 017 dependencies are deliberately checked before any SQL 028 state inspection.
  IF to_regclass('public.asset_movements') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='id' AND data_type='bigint' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='institute_id' AND data_type='integer' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='asset_id' AND data_type='bigint' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='status' AND data_type='character varying' AND character_maximum_length=30 AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='movement_type' AND data_type='character varying' AND character_maximum_length=40 AND is_nullable='NO') THEN
    RAISE EXCEPTION 'SQL_028_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;

  SELECT
    (CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='origin_movement_id') THEN 1 ELSE 0 END) +
    (CASE WHEN to_regclass('public.asset_movements_one_active_uq') IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN to_regclass('public.asset_movements_return_origin_uq') IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_movements'::regclass AND conname='asset_movements_return_origin_ck') THEN 1 ELSE 0 END)
  INTO target_count;

  IF target_count NOT IN (0,4) THEN
    RAISE EXCEPTION 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  IF target_count=4 THEN
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='origin_movement_id' AND data_type='bigint' AND is_nullable='YES')
      AND EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid='public.asset_movements'::regclass AND c.contype='f'
          AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='origin_movement_id')]
          AND c.confrelid='public.asset_movements'::regclass
          AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]
      )
      AND EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_am am ON am.oid=x.relam
        WHERE i.indexrelid='public.asset_movements_one_active_uq'::regclass
          AND i.indrelid='public.asset_movements'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
          AND am.amname='btree' AND i.indnkeyatts=2 AND i.indnatts=2
          AND pg_get_indexdef(i.indexrelid,1,true)='institute_id' AND pg_get_indexdef(i.indexrelid,2,true)='asset_id'
          -- PostgreSQL versions legitimately render varchar predicates with different
          -- combinations of ::varchar/::text casts. Strip only those no-op casts before
          -- comparing the expression; the columns, operator, values, and order remain exact.
          AND regexp_replace(
                replace(replace(replace(replace(
                  pg_get_expr(i.indpred,i.indrelid),
                  '::character varying[]',''),'::text[]',''),
                  '::character varying',''),'::text',''),
                '[ ()]','','g'
              )='status=ANYARRAY[''PENDING_APPROVAL'',''APPROVED'',''IN_TRANSIT'']'
      )
      AND EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_am am ON am.oid=x.relam
        WHERE i.indexrelid='public.asset_movements_return_origin_uq'::regclass
          AND i.indrelid='public.asset_movements'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
          AND am.amname='btree' AND i.indnkeyatts=1 AND i.indnatts=1
          AND pg_get_indexdef(i.indexrelid,1,true)='origin_movement_id'
          AND regexp_replace(
                replace(replace(replace(replace(
                  pg_get_expr(i.indpred,i.indrelid),
                  '::character varying[]',''),'::text[]',''),
                  '::character varying',''),'::text',''),
                '[ ()]','','g'
              )='movement_type=''RETURN'''
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.asset_movements'::regclass
          AND c.conname='asset_movements_return_origin_ck' AND c.contype='c' AND c.convalidated
          AND regexp_replace(
                replace(replace(replace(replace(
                  pg_get_constraintdef(c.oid),
                  '::character varying[]',''),'::text[]',''),
                  '::character varying',''),'::text',''),
                '[ ()]','','g'
              ) =
            'CHECKmovement_type=''RETURN''ANDorigin_movement_idISNOTNULLORmovement_type<>''RETURN''ANDorigin_movement_idISNULL'
      )
    INTO compatible;
    IF compatible THEN
      RAISE NOTICE 'SQL_028_ALREADY_APPLIED_COMPATIBLE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  IF EXISTS (SELECT 1 FROM public.asset_movements WHERE status IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT') GROUP BY institute_id,asset_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'SQL_028_ACTIVE_MOVEMENT_CONFLICT';
  END IF;
  -- With no origin column, historical RETURN rows cannot carry a valid origin. Fail rather
  -- than inventing business lineage; an empty RETURN set is the only clean install state.
  IF EXISTS (SELECT 1 FROM public.asset_movements WHERE movement_type='RETURN') THEN
    RAISE EXCEPTION 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  ALTER TABLE public.asset_movements ADD COLUMN origin_movement_id bigint NULL;
  ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_origin_movement_id_fkey
    FOREIGN KEY (origin_movement_id) REFERENCES public.asset_movements(id);
  CREATE UNIQUE INDEX asset_movements_one_active_uq ON public.asset_movements(institute_id,asset_id)
    WHERE status IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT');
  CREATE UNIQUE INDEX asset_movements_return_origin_uq ON public.asset_movements(origin_movement_id)
    WHERE movement_type='RETURN';
  ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_return_origin_ck CHECK (
    (movement_type='RETURN' AND origin_movement_id IS NOT NULL)
    OR (movement_type<>'RETURN' AND origin_movement_id IS NULL)
  );
END $migration$;

COMMIT;