-- MANUAL DATABASE MIGRATION REQUIRED. Run the complete file in Supabase SQL Editor.
-- Requires SQL 049 and the canonical Goods Receipt schema. Existing receipts stay accepted.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.preprocurement_technical_reviews') IS NULL OR to_regclass('public.goods_receipt_items') IS NULL THEN
  RAISE EXCEPTION 'Apply SQL 049 and the canonical P2P schema before SQL 054';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.technical_review_profiles (
 institute_id integer NOT NULL REFERENCES institutes(id),
 profile_key text NOT NULL,
 settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(institute_id,profile_key)
);
ALTER TABLE public.preprocurement_technical_review_assignments ADD COLUMN IF NOT EXISTS opinion_round integer NOT NULL DEFAULT 1 CHECK(opinion_round>0);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.preprocurement_technical_review_assignments'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%' LOOP
  EXECUTE format('ALTER TABLE public.preprocurement_technical_review_assignments DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.preprocurement_technical_review_assignments ADD CONSTRAINT technical_assignment_states CHECK(status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','CONDITIONAL','CLARIFICATION'));
ALTER TABLE public.preprocurement_technical_review_assignments ADD CONSTRAINT technical_assignment_attestation CHECK(status IN ('PENDING','IN_PROGRESS') OR (submitted_by=reviewer_id AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND signature IS NOT NULL AND jsonb_array_length(reports)>0));
CREATE TABLE IF NOT EXISTS public.delivery_inspection_tasks (
 id bigserial PRIMARY KEY,
 institute_id integer NOT NULL REFERENCES institutes(id),
 receipt_item_id bigint NOT NULL UNIQUE REFERENCES goods_receipt_items(id),
 request_id integer NOT NULL REFERENCES requests(id),
 department_id integer NOT NULL REFERENCES departments(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IN_PROGRESS','ON_HOLD','DECIDED','CLOSED')),
 profile_snapshot jsonb NOT NULL,
 pending_disposition jsonb,
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 opinion_round integer NOT NULL DEFAULT 1 CHECK(opinion_round>0),
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.delivery_inspection_assignments (
 id bigserial PRIMARY KEY,
 task_id bigint NOT NULL REFERENCES delivery_inspection_tasks(id),
 department_id integer NOT NULL REFERENCES departments(id),
 reviewer_id integer NOT NULL REFERENCES users(id),
 opinion jsonb,
 submitted_at timestamptz,
 UNIQUE(task_id,reviewer_id)
);
CREATE TABLE IF NOT EXISTS public.technical_workflow_history (
 id bigserial PRIMARY KEY,
 institute_id integer NOT NULL REFERENCES institutes(id),
 review_id bigint REFERENCES preprocurement_technical_reviews(id),
 delivery_task_id bigint REFERENCES delivery_inspection_tasks(id),
 action text NOT NULL,
 actor_id integer NOT NULL REFERENCES users(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((review_id IS NULL)<>(delivery_task_id IS NULL))
);
CREATE OR REPLACE FUNCTION public.keep_technical_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Technical workflow history is immutable'; END $$;
DROP TRIGGER IF EXISTS technical_history_immutable ON public.technical_workflow_history;
CREATE TRIGGER technical_history_immutable BEFORE UPDATE OR DELETE ON public.technical_workflow_history FOR EACH ROW EXECUTE FUNCTION public.keep_technical_history_immutable();
CREATE TABLE IF NOT EXISTS public.technical_evidence_references (
 id bigserial PRIMARY KEY,
 attachment_id integer NOT NULL,
 review_id bigint REFERENCES preprocurement_technical_reviews(id),
 delivery_task_id bigint REFERENCES delivery_inspection_tasks(id),
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT technical_evidence_attachment_fk FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE RESTRICT,
 CHECK((review_id IS NULL)<>(delivery_task_id IS NULL)),
 UNIQUE(attachment_id,review_id),
 UNIQUE(attachment_id,delivery_task_id)
);
DROP TRIGGER IF EXISTS technical_evidence_immutable ON public.technical_evidence_references;
CREATE TRIGGER technical_evidence_immutable BEFORE UPDATE OR DELETE ON public.technical_evidence_references FOR EACH ROW EXECUTE FUNCTION public.keep_technical_history_immutable();
-- Protect existing available evidence; no file, signature or decision is inferred.
INSERT INTO public.technical_evidence_references(attachment_id,review_id,created_by)
 SELECT DISTINCT a.id,r.id,r.created_by FROM public.preprocurement_technical_reviews r
 CROSS JOIN LATERAL jsonb_array_elements(r.item_packets) packet
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(packet->'evidence'->'attachment_ids')='array' THEN packet->'evidence'->'attachment_ids' ELSE '[]'::jsonb END) selected(id)
 JOIN public.attachments a ON a.id::text=selected.id AND a.request_id=r.request_id
 ON CONFLICT DO NOTHING;
INSERT INTO public.technical_evidence_references(attachment_id,review_id,delivery_task_id,created_by)
 SELECT DISTINCT a.id,h.review_id,h.delivery_task_id,h.actor_id FROM public.technical_workflow_history h
 LEFT JOIN public.preprocurement_technical_reviews r ON r.id=h.review_id
 LEFT JOIN public.delivery_inspection_tasks t ON t.id=h.delivery_task_id
 CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_path_query_array(h.payload,'$.**.attachment_ids[*]')) selected(id)
 JOIN public.attachments a ON a.id::text=selected.id AND a.request_id=COALESCE(r.request_id,t.request_id)
 ON CONFLICT DO NOTHING;
ALTER TABLE public.technical_evidence_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.technical_evidence_references FROM PUBLIC;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS technical_inspection_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS technical_accepted_quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(technical_accepted_quantity>=0);
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS technical_rejected_quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(technical_rejected_quantity>=0);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goods_receipt_items'::regclass AND conname='technical_receipt_conservation') THEN
  ALTER TABLE public.goods_receipt_items ADD CONSTRAINT technical_receipt_conservation CHECK(NOT technical_inspection_required OR technical_accepted_quantity+technical_rejected_quantity<=received_quantity-damaged_quantity-short_quantity);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS delivery_inspection_queue ON public.delivery_inspection_tasks(institute_id,status,id);
CREATE INDEX IF NOT EXISTS delivery_inspector_queue ON public.delivery_inspection_assignments(reviewer_id,task_id);
CREATE INDEX IF NOT EXISTS technical_review_history ON public.technical_workflow_history(review_id,id);
CREATE INDEX IF NOT EXISTS technical_delivery_history ON public.technical_workflow_history(delivery_task_id,id);
ALTER TABLE public.technical_review_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_inspection_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_inspection_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_workflow_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.technical_review_profiles,public.delivery_inspection_tasks,public.delivery_inspection_assignments,public.technical_workflow_history FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.technical_review_profiles,public.delivery_inspection_tasks,public.delivery_inspection_assignments,public.technical_workflow_history,public.technical_evidence_references FROM %I',r); END IF;
END LOOP; END $$;
-- No historical receipt/task backfill, inferred approvals, new grants or inventory movements.
COMMIT;
