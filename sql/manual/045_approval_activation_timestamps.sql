-- MANUAL DATABASE MIGRATION REQUIRED. Run manually in Supabase SQL Editor.
-- Historical activation times are unknown: no backfill from updated_at or
-- request creation dates. This records future active Pending ownership only.
BEGIN;
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.record_approval_activation_time()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.activated_at := CASE WHEN NEW.is_active IS TRUE
      AND NEW.status = 'Pending' AND NOT COALESCE(NEW.is_superseded, FALSE)
      THEN statement_timestamp() ELSE NULL END;
  ELSIF NEW.is_active IS TRUE AND NEW.status = 'Pending'
    AND NOT COALESCE(NEW.is_superseded, FALSE)
    AND (OLD.is_active IS DISTINCT FROM TRUE OR OLD.status IS DISTINCT FROM 'Pending'
      OR COALESCE(OLD.is_superseded, FALSE)
      OR NEW.approver_id IS DISTINCT FROM OLD.approver_id
      OR NEW.approval_level IS DISTINCT FROM OLD.approval_level) THEN
    NEW.activated_at := statement_timestamp();
  ELSE
    -- Ordinary edits/retries must not reset the clock or invent historical data.
    NEW.activated_at := OLD.activated_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS approvals_record_activation_time ON public.approvals;
CREATE TRIGGER approvals_record_activation_time BEFORE INSERT OR UPDATE
ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.record_approval_activation_time();
COMMIT;

SELECT count(*) FILTER (WHERE is_active AND status = 'Pending'
  AND NOT is_superseded AND activated_at IS NULL) AS active_pending_with_unknown_start,
  count(*) FILTER (WHERE activated_at IS NOT NULL) AS recorded_activation_times
FROM public.approvals;
