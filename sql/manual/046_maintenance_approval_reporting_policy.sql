-- MANUAL DATABASE MIGRATION REQUIRED. Apply in Supabase SQL Editor.
-- Reporting only: no request/approval history or workflow rules are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.maintenance_approval_reporting_policy (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  overdue_target_days INTEGER CHECK (overdue_target_days BETWEEN 1 AND 365),
  reason TEXT NOT NULL,
  updated_by INTEGER REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.maintenance_approval_reporting_policy (id, overdue_target_days, reason)
VALUES (1, NULL, 'No organization reporting target set') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.maintenance_approval_reporting_policy ENABLE ROW LEVEL SECURITY;
COMMIT;
SELECT * FROM public.maintenance_approval_reporting_policy;
