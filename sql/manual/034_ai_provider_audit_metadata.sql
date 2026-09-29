-- MANUAL MIGRATION 034: provider metadata for installations that already applied 033
BEGIN;

ALTER TABLE public.ai_interactions
  ADD COLUMN IF NOT EXISTS provider TEXT;

UPDATE public.ai_interactions
   SET provider = 'openai'
 WHERE provider IS NULL;

ALTER TABLE public.ai_interactions
  ALTER COLUMN provider SET NOT NULL;

COMMIT;