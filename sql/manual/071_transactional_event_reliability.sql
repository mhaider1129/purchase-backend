-- MANUAL DATABASE MIGRATION REQUIRED. Task 7C / AUD-014.
-- No historical audit/event backfill. Use the governed bundle with the 070 receipt.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5min';
DO $$ BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0)) THEN RAISE EXCEPTION 'DATABASE_RELEASE_BUSY'; END IF;
 IF to_regclass('public.notification_outbox') IS NULL OR to_regclass('public.audit_logs') IS NULL THEN RAISE EXCEPTION 'EVENT_RELIABILITY_PREREQUISITES_MISSING'; END IF;
END $$;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS institute_id integer REFERENCES public.institutes(id), ADD COLUMN IF NOT EXISTS payload_version integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS error_category text;
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check CHECK(status IN ('pending','processing','delivered','failed','dead_letter','suppressed'));
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS outbox_event_id bigint REFERENCES public.notification_outbox(id);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_outbox_event_uq ON public.notifications(outbox_event_id);
CREATE TABLE IF NOT EXISTS public.notification_email_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 outbox_event_id bigint NOT NULL REFERENCES public.notification_outbox(id),
 recipient_user_id integer NOT NULL REFERENCES public.users(id),
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 idempotency_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed','dead_letter','suppressed')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 lease_token uuid,
 lease_expires_at timestamptz,
 last_attempt_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 acknowledged_at timestamptz,
 error_category text,
 UNIQUE(outbox_event_id,recipient_user_id)
);
CREATE INDEX IF NOT EXISTS notification_email_due_idx ON public.notification_email_deliveries(next_attempt_at,id) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS notification_email_lease_idx ON public.notification_email_deliveries(lease_expires_at,id) WHERE status='processing';
CREATE TABLE IF NOT EXISTS public.event_reliability_cutovers(version text PRIMARY KEY,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO public.permissions(code,name,description) VALUES('operations.events.view','View scoped event reliability','Read institute-scoped audit/outbox reconciliation and delivery diagnostics; grants no business mutation or recipient authority.') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.event_reliability_cutovers(version) VALUES('7c') ON CONFLICT DO NOTHING;
-- The cutover timestamp is operational evidence only, never proof of old audits.
ALTER TABLE public.notification_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_reliability_cutovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_email_deliveries,public.event_reliability_cutovers FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.notification_email_deliveries_id_seq FROM PUBLIC;
DO $$ DECLARE r name; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.notification_email_deliveries,public.event_reliability_cutovers FROM %I',r); EXECUTE format('REVOKE ALL ON SEQUENCE public.notification_email_deliveries_id_seq FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend') THEN
  REVOKE ALL ON public.notification_email_deliveries,public.event_reliability_cutovers FROM purchase_backend;
  REVOKE ALL ON SEQUENCE public.notification_email_deliveries_id_seq FROM purchase_backend;
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.notification_email_deliveries,public.event_reliability_cutovers TO purchase_backend;
  GRANT USAGE,SELECT ON SEQUENCE public.notification_email_deliveries_id_seq TO purchase_backend;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_event_reliability_cutover() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'EVENT_RELIABILITY_CUTOVER_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS guard_event_reliability_cutover ON public.event_reliability_cutovers;
CREATE TRIGGER guard_event_reliability_cutover BEFORE UPDATE OR DELETE ON public.event_reliability_cutovers FOR EACH ROW EXECUTE FUNCTION public.guard_event_reliability_cutover();
REVOKE ALL ON FUNCTION public.guard_event_reliability_cutover() FROM PUBLIC;
DO $$ DECLARE r name; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.guard_event_reliability_cutover() FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend') THEN GRANT EXECUTE ON FUNCTION public.guard_event_reliability_cutover() TO purchase_backend; END IF;
END $$;
COMMIT;
