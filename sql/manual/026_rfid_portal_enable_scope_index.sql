-- 026: Add the RFID portal enabled-scope lookup index without rewriting deployed migration 017.
-- FORWARD-ONLY. Run manually after 017; never from application startup.
BEGIN;

DO $migration$
DECLARE
  index_oid oid := to_regclass('public.rfid_portal_enable_scope');
  compatible boolean;
BEGIN
  IF to_regclass('public.rfid_portals') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='rfid_portals'
      AND column_name='institute_id' AND data_type='integer' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='rfid_portals'
      AND column_name='enabled' AND data_type='boolean' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'SQL_026_DEPENDENCY_MISSING_OR_INCOMPATIBLE: run sql/manual/017_fixed_assets_rfid_core.sql first';
  END IF;

  IF index_oid IS NOT NULL THEN
    SELECT i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts=2 AND i.indnatts=2
      AND pg_get_indexdef(i.indexrelid,1,true)='institute_id'
      AND pg_get_indexdef(i.indexrelid,2,true)='enabled'
      AND pg_get_expr(i.indpred,i.indrelid)='enabled'
      AND am.amname='btree'
    INTO compatible
    FROM pg_index i
    JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_class tbl ON tbl.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=tbl.relnamespace
    JOIN pg_am am ON am.oid=idx.relam
    WHERE i.indexrelid=index_oid AND n.nspname='public' AND tbl.relname='rfid_portals';

    IF coalesce(compatible,false) THEN
      RAISE NOTICE 'SQL_026_ALREADY_APPLIED_COMPATIBLE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_026_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  CREATE INDEX rfid_portal_enable_scope
    ON public.rfid_portals(institute_id,enabled)
    WHERE enabled;
END $migration$;

COMMIT;