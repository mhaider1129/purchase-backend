-- MANUAL DATABASE MIGRATION REQUIRED: execute the entire file in Supabase SQL Editor.
-- Temporary vendor custody is not an owned-stock receipt, purchase or payable.
BEGIN;
-- The checked-in legacy snapshot can expose these SHA-256 fields as CHAR(1).
-- Widen only narrow string metadata; preserve every existing value without inventing hashes.
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['goods_receipts','supplier_invoices'] LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=target AND column_name='payload_fingerprint' AND data_type IN ('character','character varying') AND character_maximum_length<64) THEN
   EXECUTE format('ALTER TABLE public.%I ALTER COLUMN payload_fingerprint TYPE text USING payload_fingerprint::text',target);
  END IF;
 END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS public.surgical_consignment_cases (
 id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES public.institutes(id),department_id integer NOT NULL REFERENCES public.departments(id),
 created_by integer NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 surgery_date date NOT NULL,patient_mrn text NOT NULL,procedure_type text NOT NULL,requester_snapshot jsonb NOT NULL,
 surgeon_id integer NOT NULL REFERENCES public.users(id),nurse_id integer NOT NULL REFERENCES public.users(id),receiver_id integer NOT NULL REFERENCES public.users(id),
 supplier_id integer NOT NULL REFERENCES public.suppliers(id),supplier_name text NOT NULL,vendor_contact text NOT NULL,
 agreement_reference text NOT NULL,currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),requested_items jsonb NOT NULL CHECK(jsonb_typeof(requested_items)='array' AND jsonb_array_length(requested_items)>0),
 justification jsonb NOT NULL,other_justification text,
 status text NOT NULL DEFAULT 'AWAITING_AUTHORIZATION' CHECK(status IN ('AWAITING_AUTHORIZATION','AUTHORIZED','RECEIVED','RECONCILING','USAGE_REVIEW','USAGE_CONFIRMED','RECONCILED','BILLING_LINKED','CLOSED','REJECTED','CANCELLED')),
 authorization_code text UNIQUE,procedure_event_date date,procedure_outcome text CHECK(procedure_outcome IN ('PERFORMED','CANCELLED','POSTPONED')),usage_snapshot jsonb,
 billing_po_id bigint UNIQUE REFERENCES public.purchase_orders(id),row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 submission_key text NOT NULL,payload_fingerprint text NOT NULL,UNIQUE(institute_id,submission_key),
 CHECK(surgeon_id<>nurse_id AND surgeon_id<>receiver_id AND nurse_id<>receiver_id)
);
CREATE INDEX IF NOT EXISTS surgical_consignment_queue ON public.surgical_consignment_cases(institute_id,status,id DESC);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_approvals (
 case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),step integer NOT NULL CHECK(step BETWEEN 1 AND 3),role text NOT NULL CHECK(role IN ('DEPARTMENT_MANAGER','CMO','SCM')),
 approver_id integer NOT NULL REFERENCES public.users(id),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),notes text,signature jsonb,decided_at timestamptz,
 PRIMARY KEY(case_id,step),UNIQUE(case_id,approver_id),CHECK(status='PENDING' OR (signature IS NOT NULL AND decided_at IS NOT NULL AND notes IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_receipts (
 id bigserial PRIMARY KEY,case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),received_date date NOT NULL,location text NOT NULL,delivery_reference text NOT NULL,
 vendor_representative text NOT NULL,vendor_contact text NOT NULL,receiver_id integer NOT NULL REFERENCES public.users(id),receiver_signature jsonb NOT NULL,
 confirmed_by integer REFERENCES public.users(id),scm_signature jsonb,confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,delivery_reference)
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_receipt_lines (
 id bigserial PRIMARY KEY,receipt_id bigint NOT NULL REFERENCES public.surgical_consignment_receipts(id),
 requested_item_index integer NOT NULL CHECK(requested_item_index>=0),item_name text NOT NULL,catalogue_code text NOT NULL,batch_number text NOT NULL,serial_number text,expiry_date date NOT NULL,
 delivered_quantity integer NOT NULL CHECK(delivered_quantity>0),unit_price numeric(18,4) NOT NULL CHECK(unit_price>=0),sterile_intact boolean NOT NULL,accepted boolean NOT NULL,inspection_notes text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_usage_lines (
 receipt_line_id bigint PRIMARY KEY REFERENCES public.surgical_consignment_receipt_lines(id),
 used_quantity integer NOT NULL CHECK(used_quantity>=0),damaged_quantity integer NOT NULL CHECK(damaged_quantity>=0),missing_quantity integer NOT NULL CHECK(missing_quantity>=0),notes text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_returns (
 id bigserial PRIMARY KEY,case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),receipt_line_id bigint NOT NULL REFERENCES public.surgical_consignment_receipt_lines(id),
 kind text NOT NULL CHECK(kind IN ('INTACT','DAMAGED')),quantity integer NOT NULL CHECK(quantity>0),returned_date date NOT NULL,vendor_representative text NOT NULL,
 actor_id integer NOT NULL REFERENCES public.users(id),signature jsonb NOT NULL,notes text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_waivers (
 id bigserial PRIMARY KEY,case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),receipt_line_id bigint NOT NULL REFERENCES public.surgical_consignment_receipt_lines(id),
 usage_fingerprint text NOT NULL,disposed_quantity integer NOT NULL CHECK(disposed_quantity>=0),vendor_no_charge boolean NOT NULL CHECK(vendor_no_charge),
 actor_id integer NOT NULL REFERENCES public.users(id),signature jsonb NOT NULL,notes text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_attestations (
 case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),role text NOT NULL CHECK(role IN ('NURSE','SURGEON','RECEIVER','SCM_RECONCILIATION')),
 actor_id integer NOT NULL REFERENCES public.users(id),signature jsonb NOT NULL,notes text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(case_id,role)
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_files (
 id bigserial PRIMARY KEY,case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),file_name text NOT NULL,storage_name text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose IN ('AGREEMENT','RECEIPT','RETURN','USAGE','WAIVER','OTHER')),uploaded_by integer NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_events (
 id bigserial PRIMARY KEY,case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),action text NOT NULL,actor_id integer NOT NULL REFERENCES public.users(id),signature jsonb NOT NULL,
 notes text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.surgical_consignment_billing_lines (
 case_id bigint NOT NULL REFERENCES public.surgical_consignment_cases(id),receipt_line_id bigint NOT NULL REFERENCES public.surgical_consignment_receipt_lines(id),
 purchase_order_item_id bigint NOT NULL UNIQUE REFERENCES public.purchase_order_items(id),used_quantity integer NOT NULL CHECK(used_quantity>0),unit_price numeric(18,4) NOT NULL CHECK(unit_price>=0),
 PRIMARY KEY(case_id,receipt_line_id)
);
CREATE INDEX IF NOT EXISTS surgical_receipts_case_idx ON public.surgical_consignment_receipts(case_id);
CREATE INDEX IF NOT EXISTS surgical_receipt_lines_receipt_idx ON public.surgical_consignment_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS surgical_returns_case_idx ON public.surgical_consignment_returns(case_id,receipt_line_id);
CREATE INDEX IF NOT EXISTS surgical_waivers_case_idx ON public.surgical_consignment_waivers(case_id,receipt_line_id,id DESC);
CREATE INDEX IF NOT EXISTS surgical_files_case_idx ON public.surgical_consignment_files(case_id);
CREATE INDEX IF NOT EXISTS surgical_events_case_idx ON public.surgical_consignment_events(case_id,id DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['surgical_consignment_cases','surgical_consignment_approvals','surgical_consignment_receipts','surgical_consignment_receipt_lines','surgical_consignment_usage_lines','surgical_consignment_returns','surgical_consignment_waivers','surgical_consignment_attestations','surgical_consignment_files','surgical_consignment_events','surgical_consignment_billing_lines'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 END LOOP;
END $$;
COMMIT;
