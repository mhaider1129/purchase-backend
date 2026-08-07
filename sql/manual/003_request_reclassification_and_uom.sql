-- Manual migration 003: request reclassification approval-route isolation.
-- BACK UP the database and verify that the backup can be restored before running.
-- Run during a quiet window. ALTER TABLE and index creation acquire locks.
-- This migration preserves existing rows and performs no destructive delete/drop.

BEGIN;

-- LOCK RISK: each ALTER TABLE takes an ACCESS EXCLUSIVE lock briefly.
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_route_version INTEGER,
  ADD COLUMN IF NOT EXISTS route_snapshot_id TEXT;

-- Deliberately leave pre-migration rows NULL (legacy/unversioned). A request can
-- legitimately contain more than one historical approval at the same level.
-- Backfilling every legacy row to version 1 would collide with an existing
-- (request_id, approval_route_version, approval_level) unique constraint, for
-- example when request 17 has two old level-3 rows. Canonical Phase 2 inserts
-- always supply a non-NULL version; legacy writers that omit it remain usable.
-- LOCK RISK: normalize a partially attempted earlier 003 that may have made the
-- column NOT NULL or given it a default. Existing non-NULL values are preserved.
ALTER TABLE public.approvals
  ALTER COLUMN approval_route_version DROP DEFAULT,
  ALTER COLUMN approval_route_version DROP NOT NULL;

-- Add the audit actor relationship only when it is absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.approvals'::regclass
       AND conname = 'approvals_superseded_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_superseded_by_user_id_fkey
      FOREIGN KEY (superseded_by_user_id) REFERENCES public.users(id);
  END IF;
END $$;

-- Preserve legacy rows while normalizing the actionable flag. Older workflows
-- sometimes left several non-superseded Pending rows active for one request.
-- Keep exactly one deterministic row active: prefer the newest explicit route
-- version, then the earliest workflow level and row id. All other rows remain
-- Pending and visible in history; only their is_active flag becomes FALSE.
-- LOCK RISK: updates conflicting approval rows and takes row-level locks.
WITH ranked_active AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY request_id
           ORDER BY approval_route_version DESC NULLS LAST,
                    approval_level ASC NULLS LAST,
                    id ASC
         ) AS actionable_rank
    FROM public.approvals
   WHERE is_active = TRUE
     AND status = 'Pending'
     AND COALESCE(is_superseded, FALSE) = FALSE
)
UPDATE public.approvals AS approval
   SET is_active = FALSE
  FROM ranked_active
 WHERE approval.id = ranked_active.id
   AND ranked_active.actionable_rank > 1;

-- Fail clearly before unique index creation only for conflicts that cannot be
-- normalized without inventing versioned route identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.approvals
     WHERE approval_route_version IS NOT NULL
     GROUP BY request_id, approval_route_version, approval_level
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate versioned approval route steps exist; resolve them manually before migration 003';
  END IF;
END $$;

-- LOCK RISK: index builds can block writes; use a quiet maintenance window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_route_step
  ON public.approvals (request_id, approval_route_version, approval_level);

-- Enforces the application's one-actionable-step invariant while allowing
-- superseded historical rows to remain visible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_one_active_current_pending
  ON public.approvals (request_id)
  WHERE is_active = TRUE
    AND status = 'Pending'
    AND COALESCE(is_superseded, FALSE) = FALSE;

CREATE INDEX IF NOT EXISTS idx_approvals_request_id
  ON public.approvals (request_id);
CREATE INDEX IF NOT EXISTS idx_approvals_is_superseded
  ON public.approvals (is_superseded);
CREATE INDEX IF NOT EXISTS idx_approvals_route_snapshot_id
  ON public.approvals (route_snapshot_id);

COMMIT;

-- Read-only post-migration validation queries (retain the results).
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'approvals'
   AND column_name IN ('is_superseded', 'superseded_at',
     'superseded_by_user_id', 'superseded_reason',
     'approval_route_version', 'route_snapshot_id')
 ORDER BY column_name;

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'approvals'
   AND indexname IN ('uq_approvals_route_step',
     'uq_approvals_one_active_current_pending', 'idx_approvals_request_id',
     'idx_approvals_is_superseded', 'idx_approvals_route_snapshot_id')
 ORDER BY indexname;

SELECT request_id, COUNT(*) AS active_current_pending_count
  FROM public.approvals
 WHERE is_active = TRUE AND status = 'Pending'
   AND COALESCE(is_superseded, FALSE) = FALSE
 GROUP BY request_id HAVING COUNT(*) > 1;

-- Legacy duplicate levels are expected to remain unversioned. This query is
-- informational and does not indicate migration failure.
SELECT request_id, approval_level, COUNT(*) AS legacy_step_count
  FROM public.approvals
 WHERE approval_route_version IS NULL
 GROUP BY request_id, approval_level HAVING COUNT(*) > 1
 ORDER BY request_id, approval_level;

-- Rollback limitation: dropping the new columns after application use would
-- destroy supersession audit evidence. Prefer an application roll-forward.