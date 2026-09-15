-- 029: Fixed asset initial deployment and acquisition valuation.
-- MANUAL/PENDING. Run after SQL 017 and SQL 028; never from application startup.
BEGIN;

DO $migration$
DECLARE
  extension_count integer;
  movement_definition text;
  compatible boolean;
  pre029_movement_definition constant text := 'CHECKmovement_type::text=ANYARRAY[''PERMANENT_TRANSFER''::character varying,''TEMPORARY_LOAN''::character varying,''MAINTENANCE_TRANSFER''::character varying,''EXTERNAL_MAINTENANCE''::character varying,''RETURN''::character varying,''STORAGE_TRANSFER''::character varying,''DISPOSAL_TRANSFER''::character varying,''LOCATION_CORRECTION''::character varying]::text[]';
  post029_movement_definition constant text := 'CHECKmovement_type::text=ANYARRAY[''INITIAL_DEPLOYMENT''::character varying,''PERMANENT_TRANSFER''::character varying,''TEMPORARY_LOAN''::character varying,''MAINTENANCE_TRANSFER''::character varying,''EXTERNAL_MAINTENANCE''::character varying,''RETURN''::character varying,''STORAGE_TRANSFER''::character varying,''DISPOSAL_TRANSFER''::character varying,''LOCATION_CORRECTION''::character varying]::text[]';
BEGIN
  IF to_regclass('public.assets') IS NULL OR to_regclass('public.asset_movements') IS NULL OR to_regclass('public.sections') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='institute_id' AND data_type='integer' AND is_nullable='NO')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='currency' AND data_type='character' AND character_maximum_length=3)
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sections' AND column_name='id' AND data_type='integer' AND is_nullable='NO')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='movement_type' AND data_type='character varying' AND character_maximum_length=40 AND is_nullable='NO')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_movements' AND column_name='origin_movement_id' AND data_type='bigint' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'SQL_029_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;

  SELECT regexp_replace(pg_get_constraintdef(c.oid),'[ ()]','','g') INTO movement_definition
  FROM pg_constraint c WHERE c.conrelid='public.asset_movements'::regclass
    AND c.conname='asset_movements_movement_type_check' AND c.contype='c' AND c.convalidated;
  IF movement_definition IS NULL THEN RAISE EXCEPTION 'SQL_029_DEPENDENCY_MISSING_OR_INCOMPATIBLE'; END IF;

  SELECT count(*) INTO extension_count FROM (
    SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='assets'
      AND column_name=ANY(ARRAY['responsible_section_id','deployment_date','acquisition_currency','exchange_rate_to_iqd','acquisition_amount_iqd','exchange_rate_effective_date','exchange_rate_source'])
    UNION ALL SELECT conname FROM pg_constraint WHERE conrelid='public.assets'::regclass
      AND conname=ANY(ARRAY['assets_responsible_section_id_fkey','assets_acquisition_currency_format_ck','assets_exchange_rate_positive_ck','assets_acquisition_amount_iqd_nonnegative_ck'])
    UNION ALL SELECT relname FROM pg_class WHERE oid=to_regclass('public.assets_responsible_section_idx')
  ) objects;

  IF extension_count=0 THEN
    IF movement_definition<>pre029_movement_definition THEN RAISE EXCEPTION 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA'; END IF;
  ELSIF extension_count<>12 OR movement_definition<>post029_movement_definition THEN
    RAISE EXCEPTION 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA';
  ELSE
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='responsible_section_id' AND data_type='integer' AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='deployment_date' AND data_type='date' AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='acquisition_currency' AND data_type='character varying' AND character_maximum_length=3 AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='exchange_rate_to_iqd' AND data_type='numeric' AND numeric_precision=24 AND numeric_scale=6 AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='acquisition_amount_iqd' AND data_type='numeric' AND numeric_precision=24 AND numeric_scale=0 AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='exchange_rate_effective_date' AND data_type='date' AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='exchange_rate_source' AND data_type='text' AND is_nullable='YES')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.assets'::regclass AND c.conname='assets_responsible_section_id_fkey' AND c.contype='f' AND c.confrelid='public.sections'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='responsible_section_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')])
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.assets'::regclass AND c.conname='assets_acquisition_currency_format_ck' AND c.contype='c' AND c.convalidated AND regexp_replace(pg_get_constraintdef(c.oid),'[ ()]','','g')='CHECKacquisition_currencyISNULLORacquisition_currency::text~''^[A-Z]{3}$''::text')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.assets'::regclass AND c.conname='assets_exchange_rate_positive_ck' AND c.contype='c' AND c.convalidated AND regexp_replace(pg_get_constraintdef(c.oid),'[ ()]','','g')='CHECKexchange_rate_to_iqdISNULLORexchange_rate_to_iqd>0::numeric')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.assets'::regclass AND c.conname='assets_acquisition_amount_iqd_nonnegative_ck' AND c.contype='c' AND c.convalidated AND regexp_replace(pg_get_constraintdef(c.oid),'[ ()]','','g')='CHECKacquisition_amount_iqdISNULLORacquisition_amount_iqd>=0::numeric')
      AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_am am ON am.oid=x.relam WHERE i.indexrelid='public.assets_responsible_section_idx'::regclass AND i.indrelid='public.assets'::regclass AND NOT i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND am.amname='btree' AND i.indnkeyatts=2 AND i.indnatts=2 AND pg_get_indexdef(i.indexrelid,1,true)='institute_id' AND pg_get_indexdef(i.indexrelid,2,true)='responsible_section_id')
    INTO compatible;
    IF compatible THEN RAISE NOTICE 'SQL_029_ALREADY_APPLIED_COMPATIBLE'; RETURN; END IF;
    RAISE EXCEPTION 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  ALTER TABLE public.assets ADD COLUMN responsible_section_id integer NULL;
  ALTER TABLE public.assets ADD COLUMN deployment_date date NULL;
  ALTER TABLE public.assets ADD COLUMN acquisition_currency varchar(3) NULL;
  ALTER TABLE public.assets ADD COLUMN exchange_rate_to_iqd numeric(24,6) NULL;
  ALTER TABLE public.assets ADD COLUMN acquisition_amount_iqd numeric(24,0) NULL;
  ALTER TABLE public.assets ADD COLUMN exchange_rate_effective_date date NULL;
  ALTER TABLE public.assets ADD COLUMN exchange_rate_source text NULL;
  ALTER TABLE public.assets ADD CONSTRAINT assets_responsible_section_id_fkey FOREIGN KEY(responsible_section_id) REFERENCES public.sections(id);
  -- Only copy actual historical values. NULL remains NULL and no default is fabricated.
  UPDATE public.assets SET acquisition_currency=upper(btrim(currency)) WHERE currency IS NOT NULL;
  ALTER TABLE public.assets ADD CONSTRAINT assets_acquisition_currency_format_ck CHECK(acquisition_currency IS NULL OR acquisition_currency ~ '^[A-Z]{3}$');
  ALTER TABLE public.assets ADD CONSTRAINT assets_exchange_rate_positive_ck CHECK(exchange_rate_to_iqd IS NULL OR exchange_rate_to_iqd>0);
  ALTER TABLE public.assets ADD CONSTRAINT assets_acquisition_amount_iqd_nonnegative_ck CHECK(acquisition_amount_iqd IS NULL OR acquisition_amount_iqd>=0);
  CREATE INDEX assets_responsible_section_idx ON public.assets(institute_id,responsible_section_id);

  -- The drop is permitted only after the exact, named SQL 017 definition was proven above.
  ALTER TABLE public.asset_movements DROP CONSTRAINT asset_movements_movement_type_check;
  ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_movement_type_check CHECK(movement_type IN (
    'INITIAL_DEPLOYMENT','PERMANENT_TRANSFER','TEMPORARY_LOAN','MAINTENANCE_TRANSFER',
    'EXTERNAL_MAINTENANCE','RETURN','STORAGE_TRANSFER','DISPOSAL_TRANSFER','LOCATION_CORRECTION'));
END $migration$;

COMMIT;