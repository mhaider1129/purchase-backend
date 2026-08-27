-- MANUAL MIGRATION 011: Central Supply tracking ownership
-- Review and execute manually. Application code never repairs this schema at runtime.
BEGIN;

DO $$
DECLARE
  at_type text;
  by_type text;
  actor_fk boolean;
BEGIN
  IF to_regclass('public.requests') IS NULL THEN RAISE EXCEPTION '011 preflight missing: requests'; END IF;
  IF to_regclass('public.users') IS NULL THEN RAISE EXCEPTION '011 preflight missing: users'; END IF;

  SELECT data_type INTO at_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='requests' AND column_name='sent_to_central_supply_at';
  SELECT data_type INTO by_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='requests' AND column_name='sent_to_central_supply_by';
  RAISE NOTICE '011 preflight: sent_to_central_supply_at=%, sent_to_central_supply_by=%',
    coalesce(at_type, 'absent'), coalesce(by_type, 'absent');

  IF at_type IS NULL AND by_type IS NULL THEN RETURN; END IF;
  IF (at_type IS NOT NULL AND at_type <> 'timestamp with time zone')
     OR (by_type IS NOT NULL AND by_type <> 'integer') THEN
    RAISE EXCEPTION 'CENTRAL_SUPPLY_SCHEMA_PARTIAL_OR_DRIFTED';
  END IF;
  IF at_type IS NULL OR by_type IS NULL THEN RETURN; END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
    JOIN unnest(con.conkey) key(attnum) ON true
    JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=key.attnum
    JOIN pg_class target ON target.oid=con.confrelid
    WHERE con.contype='f' AND n.nspname='public' AND rel.relname='requests'
      AND a.attname='sent_to_central_supply_by' AND target.relname='users'
  ) INTO actor_fk;
  IF NOT actor_fk THEN RETURN; END IF;
  RAISE NOTICE 'SQL_011_ALREADY_APPLIED_COMPATIBLE';
END $$;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS sent_to_central_supply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_central_supply_by INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace
    JOIN unnest(con.conkey) key(attnum) ON true
    JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=key.attnum
    JOIN pg_class target ON target.oid=con.confrelid
    WHERE con.contype='f' AND n.nspname='public' AND rel.relname='requests'
      AND a.attname='sent_to_central_supply_by' AND target.relname='users'
  ) THEN
    ALTER TABLE public.requests
      ADD CONSTRAINT requests_sent_to_central_supply_by_fkey
      FOREIGN KEY (sent_to_central_supply_by) REFERENCES public.users(id);
  END IF;
END $$;

COMMIT;