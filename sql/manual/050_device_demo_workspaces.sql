-- MANUAL DATABASE MIGRATION REQUIRED. Apply through the Supabase SQL Editor.
-- Additive demo-trial records; no request approval, financial or inventory changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.device_demo_workspaces (
 id bigserial PRIMARY KEY,
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 request_id integer NOT NULL REFERENCES public.requests(id),
 request_item_id bigint NOT NULL REFERENCES public.requested_items(id),
 requesting_department_id integer NOT NULL REFERENCES public.departments(id),
 title text NOT NULL,
 objectives text NOT NULL,
 criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='array' AND jsonb_array_length(criteria)>0),
 item_snapshot jsonb NOT NULL,
 item_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVISION_REQUIRED','COO_REVIEW','SELECTED','CANCELLED')),
 created_by integer NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 submission_key text NOT NULL,
 payload_fingerprint text NOT NULL,
 UNIQUE(institute_id,submission_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS device_demo_one_current_item ON public.device_demo_workspaces(request_item_id) WHERE status<>'CANCELLED';
CREATE INDEX IF NOT EXISTS device_demo_institute_queue ON public.device_demo_workspaces(institute_id,status,id DESC);
CREATE TABLE IF NOT EXISTS public.device_demo_reviewers (
 workspace_id bigint NOT NULL REFERENCES public.device_demo_workspaces(id),
 reviewer_id integer NOT NULL REFERENCES public.users(id),
 department_id integer NOT NULL REFERENCES public.departments(id),
 PRIMARY KEY(workspace_id,reviewer_id)
);
CREATE TABLE IF NOT EXISTS public.device_demo_candidates (
 id bigserial PRIMARY KEY,
 workspace_id bigint NOT NULL REFERENCES public.device_demo_workspaces(id),
 supplier_id integer NOT NULL REFERENCES public.suppliers(id),
 supplier_name text NOT NULL,
 manufacturer text NOT NULL,
 model text NOT NULL,
 serial_number text,
 approved_product_id bigint REFERENCES public.approved_products(id),
 supplier_catalog_item_id bigint REFERENCES public.supplier_catalog_items(id),
 planned_start date NOT NULL,
 planned_end date NOT NULL CHECK(planned_end>=planned_start),
 location text NOT NULL,
 description text NOT NULL,
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','RECEIVED','EVALUATING','COMPLETED','WITHDRAWN')),
 received_at timestamptz,
 started_at timestamptz,
 completed_at timestamptz,
 returned_at timestamptz,
 created_by integer NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((approved_product_id IS NULL)=(supplier_catalog_item_id IS NULL)),
 CHECK(status NOT IN ('RECEIVED','EVALUATING','COMPLETED') OR received_at IS NOT NULL),
 CHECK(status NOT IN ('EVALUATING','COMPLETED') OR started_at IS NOT NULL),
 CHECK(status<>'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.device_demo_reports (
 id bigserial PRIMARY KEY,
 demo_id bigint NOT NULL REFERENCES public.device_demo_candidates(id),
 reviewer_id integer NOT NULL REFERENCES public.users(id),
 scores jsonb NOT NULL CHECK(jsonb_typeof(scores)='array' AND jsonb_array_length(scores)>0),
 weighted_score numeric(7,3) NOT NULL CHECK(weighted_score BETWEEN 0 AND 100),
 recommendation text NOT NULL CHECK(recommendation IN ('SUITABLE','NOT_SUITABLE')),
 findings text NOT NULL,
 safety_findings text NOT NULL,
 signature jsonb NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(demo_id,reviewer_id)
);
CREATE TABLE IF NOT EXISTS public.device_demo_selections (
 id bigserial PRIMARY KEY,
 workspace_id bigint NOT NULL REFERENCES public.device_demo_workspaces(id),
 demo_id bigint NOT NULL REFERENCES public.device_demo_candidates(id),
 rationale text NOT NULL,
 comparison_snapshot jsonb NOT NULL,
 submitted_by integer NOT NULL REFERENCES public.users(id),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 decided_by integer REFERENCES public.users(id),
 decided_at timestamptz,
 decision_notes text,
 signature jsonb,
 CHECK(status='PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_notes IS NOT NULL AND length(trim(decision_notes))>0 AND signature IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_demo_one_pending_selection ON public.device_demo_selections(workspace_id) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS public.device_demo_events (
 id bigserial PRIMARY KEY,
 workspace_id bigint NOT NULL REFERENCES public.device_demo_workspaces(id),
 demo_id bigint REFERENCES public.device_demo_candidates(id),
 action text NOT NULL,
 notes text NOT NULL,
 attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(attachment_ids)='array'),
 actor_id integer NOT NULL REFERENCES public.users(id),
 actor_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_demo_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_demo_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_demo_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_demo_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_demo_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_demo_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_demo_workspaces,public.device_demo_reviewers,public.device_demo_candidates,public.device_demo_reports,public.device_demo_selections,public.device_demo_events FROM PUBLIC;
COMMIT;
