-- MANUAL DATABASE MIGRATION REQUIRED: apply in Supabase SQL Editor before deployment.
-- PostgreSQL 14+ (range_agg). Existing approval history is read, never rewritten.
BEGIN;
CREATE INDEX IF NOT EXISTS approval_logs_request_timing_idx
  ON public.approval_logs(request_id,approval_id,timestamp,id);

CREATE OR REPLACE FUNCTION public.approval_active_elapsed_seconds(
  target_request_id bigint, period_start timestamptz, period_end timestamptz
) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  WITH events AS (
    SELECT l.approval_id,l.id,lower(trim(l.action)) AS action,
      COALESCE(l.timestamp,l.created_at)::timestamptz AS event_at
    FROM public.approval_logs l
    WHERE l.request_id=target_request_id AND l.approval_id IS NOT NULL
      AND lower(trim(l.action)) IN ('on hold','hold','resumed','resume','pending',
        'approved','rejected','superseded','cancelled','canceled','stopped by scm intervention')
      AND COALESCE(l.timestamp,l.created_at) IS NOT NULL
  ), ordered AS (
    SELECT *,lead(event_at) OVER(PARTITION BY approval_id ORDER BY event_at,id) AS next_at
    FROM events
  ), intervals AS (
    SELECT e.event_at AS started_at,
      COALESCE(e.next_at,
        CASE WHEN lower(trim(a.status))='on hold' THEN period_end
          ELSE COALESCE(a.approved_at,a.superseded_at,a.rejected_at,a.decided_at,e.event_at)::timestamptz END) AS ended_at
    FROM ordered e LEFT JOIN public.approvals a ON a.id=e.approval_id AND a.request_id=target_request_id
    WHERE e.action IN ('on hold','hold')
    UNION ALL
    -- Legacy currently-held rows without a hold event: only the known current
    -- state timestamp is usable. Never invent an earlier historical start.
    SELECT a.updated_at::timestamptz,period_end
    FROM public.approvals a
    WHERE a.request_id=target_request_id AND lower(trim(a.status))='on hold'
      AND a.is_active IS TRUE AND a.updated_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.approval_id=a.id AND e.action IN ('on hold','hold'))
  ), clipped AS (
    SELECT greatest(started_at,period_start) AS started_at,
      least(ended_at,period_end) AS ended_at
    FROM intervals
    WHERE period_start IS NOT NULL AND period_end IS NOT NULL
      AND started_at<period_end AND ended_at>period_start
  ), merged AS (
    SELECT range_agg(tstzrange(started_at,ended_at,'[)')) AS held_ranges
    FROM clipped WHERE ended_at>started_at
  ), held AS (
    SELECT COALESCE(sum(extract(epoch FROM (upper(part)-lower(part)))),0) AS seconds
    FROM merged CROSS JOIN LATERAL unnest(held_ranges) AS part
  )
  SELECT CASE WHEN period_start IS NULL OR period_end IS NULL OR period_end<period_start THEN NULL
    ELSE greatest(0,extract(epoch FROM (period_end-period_start))-(SELECT seconds FROM held)) END;
$function$;
REVOKE ALL ON FUNCTION public.approval_active_elapsed_seconds(bigint,timestamptz,timestamptz) FROM PUBLIC;
COMMENT ON FUNCTION public.approval_active_elapsed_seconds(bigint,timestamptz,timestamptz)
  IS 'Elapsed seconds excluding the union of recorded approval hold intervals overlapping the measurement window. Invoker rights; no history mutation.';
COMMIT;
