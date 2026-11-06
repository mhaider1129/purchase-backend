-- MANUAL DATABASE MIGRATION REQUIRED. Task 7B / AUD-012.
-- Requires the reviewed Task 7A release and existing RFID core. No raw observation,
-- asset, stock, count, reconciliation, historical audit or notification backfill.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5min';
DO $$ BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0)) THEN RAISE EXCEPTION 'DATABASE_RELEASE_BUSY'; END IF;
 IF to_regclass('public.database_release_migrations') IS NULL OR to_regclass('public.rfid_read_events') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend') THEN
  RAISE EXCEPTION 'RFID_RECOVERY_PREREQUISITES_MISSING';
 END IF;
END $$;
ALTER TABLE public.rfid_read_events
 ADD COLUMN IF NOT EXISTS source_fingerprint text,
 ADD COLUMN IF NOT EXISTS processing_lease_token uuid,
 ADD COLUMN IF NOT EXISTS processing_worker_id uuid,
 ADD COLUMN IF NOT EXISTS processing_claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS processing_heartbeat_at timestamptz,
 ADD COLUMN IF NOT EXISTS processing_lease_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS processing_next_attempt_at timestamptz,
 ADD COLUMN IF NOT EXISTS processing_error_code text,
 ADD COLUMN IF NOT EXISTS processing_recovery_count integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS processing_last_recovered_at timestamptz;
-- Extend only the existing technical job state; leave historical outcomes intact.
ALTER TABLE public.rfid_read_events DROP CONSTRAINT rfid_read_events_processing_status_check;
ALTER TABLE public.rfid_read_events ADD CONSTRAINT rfid_read_events_processing_status_check
 CHECK(processing_status IN ('PENDING','PROCESSING','PROCESSED','FAILED','IGNORED','DEAD_LETTER'));
CREATE UNIQUE INDEX IF NOT EXISTS rfid_read_source_fingerprint_uq ON public.rfid_read_events(integration_client_id,source_fingerprint) WHERE source_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rfid_read_institute_identity_uq ON public.rfid_read_events(id,institute_id);
CREATE INDEX IF NOT EXISTS rfid_processing_due_idx ON public.rfid_read_events(processing_next_attempt_at,read_timestamp,id) WHERE processing_status IN ('PENDING','FAILED');
CREATE INDEX IF NOT EXISTS rfid_processing_stale_idx ON public.rfid_read_events(processing_lease_expires_at,id) WHERE processing_status='PROCESSING';
CREATE TABLE IF NOT EXISTS public.rfid_processing_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 read_event_id bigint NOT NULL,
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 lease_token uuid NOT NULL UNIQUE,
 worker_id uuid NOT NULL,
 actor_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 outcome text NOT NULL CHECK(outcome IN ('CLAIMED','COMPLETED','RETRY','DEAD_LETTER','LEASE_EXPIRED')),
 error_code text,
 UNIQUE(read_event_id,attempt_number),
 FOREIGN KEY(read_event_id,institute_id) REFERENCES public.rfid_read_events(id,institute_id)
);
CREATE INDEX IF NOT EXISTS rfid_processing_attempts_scope_idx ON public.rfid_processing_attempts(institute_id,read_event_id,id);
ALTER TABLE public.rfid_processing_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rfid_processing_attempts FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.rfid_processing_attempts_id_seq FROM PUBLIC;
DO $$ DECLARE r name; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated']::name[] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.rfid_processing_attempts FROM %I',r);
   EXECUTE format('REVOKE ALL ON SEQUENCE public.rfid_processing_attempts_id_seq FROM %I',r);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON public.rfid_processing_attempts FROM purchase_backend;
REVOKE ALL ON SEQUENCE public.rfid_processing_attempts_id_seq FROM purchase_backend;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.rfid_processing_attempts FROM service_role;
  REVOKE ALL ON SEQUENCE public.rfid_processing_attempts_id_seq FROM service_role;
  GRANT SELECT ON public.rfid_processing_attempts TO service_role;
 END IF;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rfid_processing_attempts TO purchase_backend;
GRANT USAGE,SELECT ON SEQUENCE public.rfid_processing_attempts_id_seq TO purchase_backend;
-- Match the canonical runtime DML contract; an independent trigger forbids deletion
-- and mutation of finalized evidence, even by the table owner.
CREATE OR REPLACE FUNCTION public.guard_rfid_attempt_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.outcome<>'CLAIMED' THEN RAISE EXCEPTION 'RFID_ATTEMPT_HISTORY_IMMUTABLE'; END IF;
 IF (to_jsonb(NEW)-ARRAY['outcome','finished_at','error_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','finished_at','error_code']) OR NEW.outcome='CLAIMED' OR NEW.finished_at IS NULL THEN RAISE EXCEPTION 'RFID_ATTEMPT_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_rfid_attempt_history ON public.rfid_processing_attempts;
CREATE TRIGGER guard_rfid_attempt_history BEFORE UPDATE OR DELETE ON public.rfid_processing_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_rfid_attempt_history();
REVOKE ALL ON FUNCTION public.guard_rfid_attempt_history() FROM PUBLIC;
DO $$ DECLARE r name; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated']::name[] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.guard_rfid_attempt_history() FROM %I',r); END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.guard_rfid_attempt_history() TO purchase_backend;
COMMIT;
