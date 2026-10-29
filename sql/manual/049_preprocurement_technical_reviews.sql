-- MANUAL DATABASE MIGRATION REQUIRED. Apply in Supabase SQL Editor before deployment.
-- Pre-procurement technical clearance is separate from receipt acceptance.
BEGIN;
CREATE TABLE IF NOT EXISTS public.preprocurement_technical_review_policy (
  institute_id bigint PRIMARY KEY REFERENCES public.institutes(id),
  require_for_all boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  updated_by integer NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.preprocurement_technical_reviews (
  id bigserial PRIMARY KEY,
  institute_id bigint NOT NULL REFERENCES public.institutes(id),
  request_id integer NOT NULL REFERENCES public.requests(id),
  requesting_department_id integer NOT NULL REFERENCES public.departments(id),
  status text NOT NULL DEFAULT 'IN_REVIEW' CHECK(status IN ('IN_REVIEW','APPROVED','REJECTED','CANCELLED')),
  item_packets jsonb NOT NULL CHECK(jsonb_typeof(item_packets)='array' AND jsonb_array_length(item_packets)>0),
  instructions text NOT NULL,
  submission_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  created_by integer NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  signed_by integer REFERENCES public.users(id),
  signed_at timestamptz,
  signer_snapshot jsonb,
  decision_notes text,
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(institute_id,submission_key),
  CHECK(status='IN_REVIEW' OR (signed_by IS NOT NULL AND signed_at IS NOT NULL AND signer_snapshot IS NOT NULL AND decision_notes IS NOT NULL AND length(trim(decision_notes))>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS preprocurement_review_one_open_request
  ON public.preprocurement_technical_reviews(request_id) WHERE status='IN_REVIEW';
CREATE INDEX IF NOT EXISTS preprocurement_review_request_history
  ON public.preprocurement_technical_reviews(request_id,id DESC);
CREATE TABLE IF NOT EXISTS public.preprocurement_technical_review_assignments (
  id bigserial PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES public.preprocurement_technical_reviews(id),
  department_id integer NOT NULL REFERENCES public.departments(id),
  reviewer_id integer NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  reports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reports)='array'),
  submitted_by integer REFERENCES public.users(id),
  submitted_at timestamptz,
  signature jsonb,
  UNIQUE(review_id,reviewer_id),
  CHECK(status='PENDING' OR (submitted_by IS NOT NULL AND submitted_by=reviewer_id AND submitted_at IS NOT NULL AND signature IS NOT NULL AND jsonb_array_length(reports)>0))
);
CREATE INDEX IF NOT EXISTS preprocurement_review_reviewer_queue
  ON public.preprocurement_technical_review_assignments(reviewer_id,review_id);
ALTER TABLE public.preprocurement_technical_review_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preprocurement_technical_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preprocurement_technical_review_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preprocurement_technical_review_policy,public.preprocurement_technical_reviews,public.preprocurement_technical_review_assignments FROM PUBLIC;
-- No history backfill, permission grants, receipt-state changes or inferred signatures.
COMMIT;
