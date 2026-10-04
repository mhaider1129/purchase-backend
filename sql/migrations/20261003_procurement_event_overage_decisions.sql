-- Persist the SCM decision metadata used by the procurement overage workflow.
--
-- The overage status columns were introduced with the workflow itself, but the
-- decision endpoint also writes the approver, decision time, and note.  Keep
-- this migration idempotent so it is safe to apply to existing installations.

ALTER TABLE public.procurement_item_events
  ADD COLUMN IF NOT EXISTS overage_decided_by INTEGER,
  ADD COLUMN IF NOT EXISTS overage_decided_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS overage_decision_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'procurement_item_events_overage_decided_by_fkey'
      AND conrelid = 'public.procurement_item_events'::regclass
  ) THEN
    ALTER TABLE public.procurement_item_events
      ADD CONSTRAINT procurement_item_events_overage_decided_by_fkey
      FOREIGN KEY (overage_decided_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_procurement_item_events_overage_decided_by
  ON public.procurement_item_events(overage_decided_by);
