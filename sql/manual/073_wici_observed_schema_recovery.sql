-- MANUAL DATABASE MIGRATION REQUIRED. Recovery only: DB_RELEASE_SCHEMA_PROFILE=wici-2026-11.
-- Execute only the generated, checksum-bound bundle after backup and Development review.
-- A new observed-controls baseline, not fabricated receipts for SQL 069-072.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5min';
DO $$ BEGIN
 IF to_regclass('public.database_release_migrations') IS NULL OR to_regclass('public.rfid_processing_attempts') IS NULL OR to_regclass('public.notification_email_deliveries') IS NULL THEN
  RAISE EXCEPTION 'WICI_RECOVERY_REQUIRES_EXISTING_069_070_071_CONTROLS';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='purchase_backend' AND rolbypassrls AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole) THEN
  RAISE EXCEPTION 'WICI_RECOVERY_BACKEND_ROLE_REQUIRES_REVIEW';
 END IF;
END $$;
-- Reviewed catch-up of 066_contract_financial_reconciliation; does not claim its historical execution.

SET LOCAL lock_timeout='3s';

DO $$ BEGIN
 IF to_regprocedure('public.guard_canonical_invoice_contract_source()') IS NULL THEN
  RAISE EXCEPTION 'Complete canonical contract finance SQL 065 is required';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.contract_financial_reviews (
 id BIGSERIAL PRIMARY KEY,
 institute_id INTEGER NOT NULL REFERENCES public.institutes(id),
 contract_id INTEGER NOT NULL REFERENCES public.contracts(id),
 record_type TEXT NOT NULL CHECK(record_type IN ('legacy_invoice','legacy_payment')),
 source_id BIGINT NOT NULL CHECK(source_id>0),
 revision INTEGER NOT NULL CHECK(revision>0),
 decision TEXT NOT NULL CHECK(decision IN ('CONFIRMED_MATCH','REJECTED_PROPOSAL','CONFLICTING','NEEDS_INVESTIGATION')),
 canonical_ids BIGINT[] NOT NULL DEFAULT '{}',
 source_fingerprint TEXT NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence_snapshot JSONB NOT NULL,
 supporting_evidence TEXT NOT NULL CHECK(length(trim(supporting_evidence)) BETWEEN 1 AND 8000),
 notes TEXT NOT NULL CHECK(length(trim(notes)) BETWEEN 1 AND 4000),
 reviewer_id INTEGER NOT NULL REFERENCES public.users(id),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 command_key TEXT NOT NULL CHECK(length(command_key) BETWEEN 8 AND 200),
 command_fingerprint TEXT NOT NULL CHECK(command_fingerprint ~ '^[a-f0-9]{64}$'),
 UNIQUE(institute_id,record_type,source_id,revision),
 UNIQUE(institute_id,command_key)
);

CREATE INDEX IF NOT EXISTS contract_financial_reviews_worklist_idx ON public.contract_financial_reviews(institute_id,contract_id,record_type,source_id,revision DESC);

CREATE OR REPLACE FUNCTION public.preserve_contract_financial_reviews() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Financial reconciliation reviews are append-only; record a new revision' USING ERRCODE='23514'; END $$;

DROP TRIGGER IF EXISTS contract_financial_reviews_append_only ON public.contract_financial_reviews;

CREATE TRIGGER contract_financial_reviews_append_only BEFORE UPDATE OR DELETE ON public.contract_financial_reviews FOR EACH ROW EXECUTE FUNCTION public.preserve_contract_financial_reviews();

DROP TRIGGER IF EXISTS contract_financial_reviews_no_truncate ON public.contract_financial_reviews;

CREATE TRIGGER contract_financial_reviews_no_truncate BEFORE TRUNCATE ON public.contract_financial_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_contract_financial_reviews();

ALTER TABLE public.contract_financial_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.contract_financial_reviews FROM PUBLIC;

REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.contract_financial_reviews FROM anon; REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.contract_financial_reviews FROM authenticated; REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.contract_financial_reviews FROM service_role;
  REVOKE ALL ON SEQUENCE public.contract_financial_reviews_id_seq FROM service_role;
  GRANT SELECT,INSERT ON public.contract_financial_reviews TO service_role;
  GRANT USAGE,SELECT ON SEQUENCE public.contract_financial_reviews_id_seq TO service_role;
 END IF;
END $$;
-- Reviewed catch-up of 072_scop_operational_foundation; does not claim its historical execution.

SET LOCAL lock_timeout='3s';

SET LOCAL statement_timeout='5min';

DO $$ BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0)) THEN RAISE EXCEPTION 'DATABASE_RELEASE_BUSY'; END IF;
 IF to_regprocedure('public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)') IS NULL OR to_regclass('public.database_release_migrations') IS NULL THEN RAISE EXCEPTION 'SCOP_PREREQUISITES_MISSING'; END IF;
END $$;

-- Read-only per-execution-row projection of the existing canonical 067 supply invariants.
-- Existing aggregate completion and stock posting are unchanged.
CREATE OR REPLACE FUNCTION public.canonical_supply_line_quantity(p_supplied_line_id integer,p_institute_id integer)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH supplied AS (
 SELECT s.id,s.supplied_quantity,
   COALESCE((SELECT SUM(-m.quantity-COALESCE((SELECT SUM(rv.quantity) FROM public.inventory_transactions rv WHERE rv.reversal_of_movement_id=m.id AND rv.institute_id=m.institute_id AND rv.warehouse_id=m.warehouse_id),0))
    FROM public.inventory_transactions m JOIN public.stock_items stock ON stock.id=m.stock_item_id
    WHERE m.movement_type='ISSUE' AND m.reversal_of_movement_id IS NULL AND m.quantity<0 AND m.stock_status='AVAILABLE'
      AND m.source_document_type='warehouse_supply' AND m.source_document_id=r.id::text AND m.source_document_line_id=s.id::text
      AND m.institute_id=p_institute_id AND m.warehouse_id=r.supply_warehouse_id AND m.department_id=r.department_id
      AND (ri.id IS NULL OR (ri.generic_item_id IS NULL OR ri.generic_item_id=stock.generic_item_id))
      AND (ri.id IS NULL OR (upper(trim(COALESCE(ri.unit_of_measure,'')))=upper(trim(m.base_uom)) OR EXISTS(SELECT 1 FROM public.item_uom completion_uom WHERE completion_uom.id=stock.inventory_uom_id AND upper(trim(ri.unit_of_measure)) IN (upper(trim(completion_uom.uom_code)),upper(trim(completion_uom.uom_name))))))),0) net_issue
 FROM public.warehouse_supply_items wsi JOIN public.requests r ON r.id=wsi.request_id
 JOIN public.warehouses w ON w.id=r.supply_warehouse_id AND w.institute_id=r.institute_id
 JOIN public.warehouse_supplied_items s ON s.item_id=wsi.id AND s.request_id=r.id
 LEFT JOIN public.requested_items ri ON ri.id=wsi.requested_item_id
 LEFT JOIN public.requests original_request ON original_request.id=ri.request_id
 WHERE s.id=p_supplied_line_id AND r.institute_id=p_institute_id AND r.request_type='Warehouse Supply'
 AND lower(trim(r.status)) IN ('approved','completed','received','closed')
 AND lower(trim(COALESCE(to_jsonb(wsi)->>'approval_status','approved'))) <> 'rejected'
 AND (wsi.requested_item_id IS NULL OR ri.id IS NOT NULL)
 AND (ri.id IS NULL OR (original_request.institute_id=r.institute_id AND original_request.department_id=r.department_id))
 ) SELECT COALESCE(SUM(LEAST(supplied_quantity,GREATEST(net_issue,0))),0) FROM supplied
$$;


CREATE TABLE IF NOT EXISTS public.scop_request_purposes (
 code text PRIMARY KEY, label text NOT NULL, is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.scop_fulfillment_policies (
 code text PRIMARY KEY, label text NOT NULL, requires_local_override boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.scop_request_purposes(code,label) VALUES ('ROUTINE','Routine requirement'),('REPLACEMENT','Replacement'),('RECURRING','Recurring requirement'),('PATIENT_SPECIFIC','Patient-specific requirement'),('URGENT','Urgent requirement (no approval bypass)') ON CONFLICT DO NOTHING;

INSERT INTO public.scop_fulfillment_policies(code,label,requires_local_override) VALUES ('STANDARD','Approved standard fulfillment',false),('CENTER_FIRST','Central Supply first',true),('STOCK_FIRST','Warehouse stock first',true),('CONTRACT_FIRST','Existing contract first',true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.scop_requirement_profiles (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 request_id integer NOT NULL REFERENCES public.requests(id),
 requested_item_id integer UNIQUE REFERENCES public.requested_items(id),
 warehouse_supply_item_id integer UNIQUE REFERENCES public.warehouse_supply_items(id),
 category_id integer NOT NULL REFERENCES public.item_categories(id),
 requesting_function_id integer NOT NULL REFERENCES public.departments(id),
 purpose_code text NOT NULL REFERENCES public.scop_request_purposes(code),
 policy_code text NOT NULL REFERENCES public.scop_fulfillment_policies(code),
 approved_quantity numeric(24,6) NOT NULL CHECK(approved_quantity>0),
 uom text,
 approval_snapshot jsonb NOT NULL CHECK(jsonb_typeof(approval_snapshot)='object'),
 created_by integer NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(num_nonnulls(requested_item_id,warehouse_supply_item_id)=1)
);

CREATE INDEX IF NOT EXISTS scop_profiles_request_idx ON public.scop_requirement_profiles(request_id,institute_id);

CREATE TABLE IF NOT EXISTS public.scop_fulfillment_allocations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 profile_id bigint NOT NULL REFERENCES public.scop_requirement_profiles(id),
 parent_allocation_id bigint REFERENCES public.scop_fulfillment_allocations(id),
 source_kind text NOT NULL CHECK(source_kind IN ('WAREHOUSE_STOCK','CENTRAL_SUPPLY','LOCAL_PROCUREMENT','CONTRACT','TRANSFER')),
 warehouse_id integer REFERENCES public.warehouses(id),
 contract_id integer REFERENCES public.contracts(id),
 transfer_id integer REFERENCES public.warehouse_transfer_requests(id),
 transfer_line_id integer REFERENCES public.warehouse_transfer_items(id),
 responsible_user_id integer NOT NULL REFERENCES public.users(id),
 quantity numeric(24,6) NOT NULL CHECK(quantity>0),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED','SPLIT','CLOSED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason))>0),
 evidence_note text,
 created_by integer NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((source_kind IN ('WAREHOUSE_STOCK','TRANSFER'))=(warehouse_id IS NOT NULL)),
 CHECK((source_kind='CONTRACT')=(contract_id IS NOT NULL)),
 CHECK((source_kind='TRANSFER')=(transfer_id IS NOT NULL)),
 CHECK((source_kind='TRANSFER')=(transfer_line_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS scop_allocations_profile_idx ON public.scop_fulfillment_allocations(profile_id,id);

CREATE TABLE IF NOT EXISTS public.scop_allocation_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 allocation_id bigint NOT NULL REFERENCES public.scop_fulfillment_allocations(id),
 po_line_id bigint UNIQUE REFERENCES public.purchase_order_items(id),
 receipt_line_id bigint UNIQUE REFERENCES public.goods_receipt_items(id),
 supply_line_id integer UNIQUE REFERENCES public.warehouse_supplied_items(id),
 created_by integer NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(num_nonnulls(po_line_id,receipt_line_id,supply_line_id)=1)
);

CREATE INDEX IF NOT EXISTS scop_evidence_allocation_idx ON public.scop_allocation_evidence(allocation_id);

CREATE TABLE IF NOT EXISTS public.scop_allocation_commands (
 institute_id integer NOT NULL REFERENCES public.institutes(id),
 command_key text NOT NULL CHECK(length(command_key) BETWEEN 1 AND 120),
 actor_id integer NOT NULL REFERENCES public.users(id),
 request_id integer NOT NULL REFERENCES public.requests(id),
 fingerprint text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(institute_id,command_key)
);

CREATE OR REPLACE FUNCTION public.scop_preserve_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'SCOP history is immutable; use a reviewed forward reconciliation'; END $$;

DROP TRIGGER IF EXISTS scop_evidence_immutable ON public.scop_allocation_evidence;

CREATE TRIGGER scop_evidence_immutable BEFORE UPDATE OR DELETE ON public.scop_allocation_evidence FOR EACH ROW EXECUTE FUNCTION public.scop_preserve_evidence();

DROP TRIGGER IF EXISTS scop_commands_immutable ON public.scop_allocation_commands;

CREATE TRIGGER scop_commands_immutable BEFORE UPDATE OR DELETE ON public.scop_allocation_commands FOR EACH ROW EXECUTE FUNCTION public.scop_preserve_evidence();

DROP TRIGGER IF EXISTS scop_profiles_immutable ON public.scop_requirement_profiles;

CREATE TRIGGER scop_profiles_immutable BEFORE UPDATE OR DELETE ON public.scop_requirement_profiles FOR EACH ROW EXECUTE FUNCTION public.scop_preserve_evidence();

CREATE OR REPLACE FUNCTION public.scop_guard_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r public.requests; n numeric;
BEGIN
 SELECT * INTO r FROM public.requests WHERE id=NEW.request_id FOR UPDATE;
 IF r.id IS NULL OR r.institute_id IS DISTINCT FROM NEW.institute_id OR r.department_id IS DISTINCT FROM NEW.requesting_function_id OR lower(trim(r.status))<>'approved' THEN RAISE EXCEPTION 'SCOP profile ownership or approval mismatch'; END IF;
 IF NEW.requested_item_id IS NOT NULL AND r.request_type<>'Warehouse Supply' THEN SELECT quantity INTO n FROM public.requested_items WHERE id=NEW.requested_item_id AND request_id=r.id;
 ELSIF NEW.warehouse_supply_item_id IS NOT NULL AND r.request_type='Warehouse Supply' THEN SELECT quantity INTO n FROM public.warehouse_supply_items WHERE id=NEW.warehouse_supply_item_id AND request_id=r.id AND requested_item_id IS NULL;
 END IF;
 IF n IS NULL OR n<>NEW.approved_quantity THEN RAISE EXCEPTION 'SCOP profile source or quantity mismatch'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scop_profile_guard ON public.scop_requirement_profiles;

CREATE TRIGGER scop_profile_guard BEFORE INSERT ON public.scop_requirement_profiles FOR EACH ROW EXECUTE FUNCTION public.scop_guard_profile();

CREATE OR REPLACE FUNCTION public.scop_guard_allocation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.scop_requirement_profiles; r public.requests; n numeric; total numeric; transfer_quantity numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SCOP allocations cannot be deleted'; END IF;
 SELECT * INTO p FROM public.scop_requirement_profiles WHERE id=NEW.profile_id;
 SELECT * INTO r FROM public.requests WHERE id=p.request_id FOR UPDATE;
 IF p.id IS NULL OR p.institute_id IS DISTINCT FROM r.institute_id THEN RAISE EXCEPTION 'SCOP ownership mismatch'; END IF;
 IF TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'SCOP revision must advance exactly once'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.scop_allocation_evidence WHERE allocation_id=OLD.id) AND (NEW.status IN ('SPLIT','CANCELLED') OR NEW.source_kind<>OLD.source_kind OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.transfer_id IS DISTINCT FROM OLD.transfer_id OR NEW.transfer_line_id IS DISTINCT FROM OLD.transfer_line_id OR NEW.responsible_user_id<>OLD.responsible_user_id) THEN RAISE EXCEPTION 'SCOP attributed evidence cannot move'; END IF;
 IF TG_OP='UPDATE' AND (NEW.profile_id<>OLD.profile_id OR NEW.parent_allocation_id IS DISTINCT FROM OLD.parent_allocation_id OR OLD.status<>'ACTIVE' OR NEW.quantity<>OLD.quantity) THEN RAISE EXCEPTION 'SCOP history cannot be reassigned or rewritten'; END IF;
 IF p.requested_item_id IS NOT NULL THEN SELECT quantity INTO n FROM public.requested_items WHERE id=p.requested_item_id AND request_id=r.id;
 ELSE SELECT quantity INTO n FROM public.warehouse_supply_items WHERE id=p.warehouse_supply_item_id AND request_id=r.id; END IF;
 SELECT COALESCE(SUM(quantity),0) INTO total FROM public.scop_fulfillment_allocations WHERE profile_id=p.id AND status IN ('ACTIVE','CLOSED') AND id<>NEW.id;
 IF n IS NULL OR total + (CASE WHEN NEW.status IN ('ACTIVE','CLOSED') THEN NEW.quantity ELSE 0 END) > LEAST(n,p.approved_quantity) THEN RAISE EXCEPTION 'SCOP approved capacity exceeded' USING ERRCODE='23514'; END IF;
 IF NEW.parent_allocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.scop_fulfillment_allocations WHERE id=NEW.parent_allocation_id AND profile_id=p.id AND status='SPLIT') THEN RAISE EXCEPTION 'SCOP split parent mismatch'; END IF;
 IF NEW.transfer_line_id IS NOT NULL AND NEW.status IN ('ACTIVE','CLOSED') THEN
   SELECT quantity INTO transfer_quantity FROM public.warehouse_transfer_items WHERE id=NEW.transfer_line_id AND transfer_id=NEW.transfer_id FOR UPDATE;
   SELECT COALESCE(SUM(quantity),0) INTO total FROM public.scop_fulfillment_allocations WHERE transfer_line_id=NEW.transfer_line_id AND status IN ('ACTIVE','CLOSED') AND id<>NEW.id;
   IF transfer_quantity IS NULL OR total+NEW.quantity>transfer_quantity THEN RAISE EXCEPTION 'SCOP transfer capacity exceeded' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scop_allocation_guard ON public.scop_fulfillment_allocations;

CREATE TRIGGER scop_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.scop_fulfillment_allocations FOR EACH ROW EXECUTE FUNCTION public.scop_guard_allocation();

ALTER TABLE public.scop_request_purposes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scop_fulfillment_policies ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scop_requirement_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scop_fulfillment_allocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scop_allocation_evidence ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.scop_allocation_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.scop_request_purposes,public.scop_fulfillment_policies,public.scop_requirement_profiles,public.scop_fulfillment_allocations,public.scop_allocation_evidence,public.scop_allocation_commands FROM PUBLIC,anon,authenticated,purchase_backend;

REVOKE ALL ON FUNCTION public.scop_guard_allocation(),public.scop_preserve_evidence(),public.scop_guard_profile(),public.canonical_supply_line_quantity(integer,integer) FROM PUBLIC,anon,authenticated,purchase_backend;

REVOKE ALL ON SEQUENCE public.scop_requirement_profiles_id_seq,public.scop_fulfillment_allocations_id_seq,public.scop_allocation_evidence_id_seq FROM PUBLIC,anon,authenticated,purchase_backend;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON public.scop_request_purposes,public.scop_fulfillment_policies,public.scop_requirement_profiles,public.scop_fulfillment_allocations,public.scop_allocation_evidence,public.scop_allocation_commands FROM service_role;
  REVOKE ALL ON SEQUENCE public.scop_requirement_profiles_id_seq,public.scop_fulfillment_allocations_id_seq,public.scop_allocation_evidence_id_seq FROM service_role;
  REVOKE ALL ON FUNCTION public.scop_guard_allocation(),public.scop_preserve_evidence(),public.scop_guard_profile(),public.canonical_supply_line_quantity(integer,integer) FROM service_role;
 END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.scop_guard_allocation(),public.scop_preserve_evidence(),public.scop_guard_profile(),public.canonical_supply_line_quantity(integer,integer) TO purchase_backend;

GRANT SELECT ON public.scop_request_purposes,public.scop_fulfillment_policies TO purchase_backend;

GRANT SELECT,INSERT ON public.scop_requirement_profiles,public.scop_allocation_evidence,public.scop_allocation_commands TO purchase_backend;

GRANT SELECT,INSERT,UPDATE ON public.scop_fulfillment_allocations TO purchase_backend;

GRANT USAGE,SELECT ON SEQUENCE public.scop_requirement_profiles_id_seq,public.scop_fulfillment_allocations_id_seq,public.scop_allocation_evidence_id_seq TO purchase_backend;

INSERT INTO public.permissions(code,name,description) VALUES
 ('scop.allocations.view','View operational allocations','Read institute-scoped requirement classification, allocation and canonical progress.'),
 ('scop.allocations.manage','Manage operational allocations','Classify approved requirements and manage fulfillment responsibility; grants no approval, procurement, inventory or financial posting.'),
 ('scop.allocations.override-policy','Override operational sourcing policy','Record evidenced exceptions to source-channel allocation policy; grants no procurement approval or stock/financial posting.') ON CONFLICT(code) DO NOTHING;
-- Legacy required identifiers are supplied only in the hosted schema. Keep
-- the canonical writer compatible with schemas that have no legacy aliases.
CREATE OR REPLACE FUNCTION public.wici_journal_identifier_aliases() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 NEW.journal_number := COALESCE(NEW.journal_number, NEW.journal_reference);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.wici_journal_line_identifier_aliases() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 NEW.line_number := COALESCE(NEW.line_number, NEW.line_no);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wici_journal_identifiers ON public.journal_entries;
CREATE TRIGGER wici_journal_identifiers BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.wici_journal_identifier_aliases();
DROP TRIGGER IF EXISTS wici_journal_line_identifiers ON public.journal_entry_lines;
CREATE TRIGGER wici_journal_line_identifiers BEFORE INSERT ON public.journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION public.wici_journal_line_identifier_aliases();
-- Normalize only the seven reviewed routines installed above. This makes a
-- Windows clipboard CRLF paste equivalent to the repository LF source without
-- accepting arbitrary changed function bodies or touching pre-existing routines.
DO $normalize_recovery$ DECLARE routine record; BEGIN
 FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('preserve_contract_financial_reviews','canonical_supply_line_quantity','scop_preserve_evidence','scop_guard_profile','scop_guard_allocation','wici_journal_identifier_aliases','wici_journal_line_identifier_aliases') LOOP
  EXECUTE replace(replace(pg_get_functiondef(routine.oid),E'\r\n',E'\n'),E'\r',E'\n');
 END LOOP;
END $normalize_recovery$;
-- Preserve existing numeric values while removing quantity/conversion typmods
-- that silently round new canonical receipt and allocation evidence. Monetary
-- columns are deliberately unchanged; no historical quantity is reconstructed.
ALTER TABLE public.goods_receipt_items ALTER COLUMN damaged_quantity TYPE numeric;
ALTER TABLE public.goods_receipt_items ALTER COLUMN ordered_quantity TYPE numeric;
ALTER TABLE public.goods_receipt_items ALTER COLUMN received_quantity TYPE numeric;
ALTER TABLE public.goods_receipt_items ALTER COLUMN short_quantity TYPE numeric;
ALTER TABLE public.goods_receipt_items ALTER COLUMN technical_accepted_quantity TYPE numeric;
ALTER TABLE public.goods_receipt_items ALTER COLUMN technical_rejected_quantity TYPE numeric;
ALTER TABLE public.invoice_items ALTER COLUMN quantity TYPE numeric;
ALTER TABLE public.item_conversion ALTER COLUMN conversion_factor TYPE numeric;
ALTER TABLE public.purchase_order_items ALTER COLUMN invoiced_quantity TYPE numeric;
ALTER TABLE public.purchase_order_items ALTER COLUMN quantity TYPE numeric;
ALTER TABLE public.purchase_order_items ALTER COLUMN received_quantity TYPE numeric;
ALTER TABLE public.requested_items ALTER COLUMN receipt_issue_quantity TYPE numeric;
ALTER TABLE public.requested_items ALTER COLUMN received_quantity TYPE numeric;
-- Protect canonical journal identities without changing historical amounts/rows.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.journal_entries GROUP BY journal_reference HAVING count(*)>1) THEN
  RAISE EXCEPTION 'WICI_RECOVERY_DUPLICATE_JOURNAL_REFERENCE_REQUIRES_FINANCE_REVIEW';
 END IF;
 IF EXISTS(SELECT 1 FROM public.journal_entry_lines GROUP BY journal_entry_id,line_no HAVING count(*)>1) THEN
  RAISE EXCEPTION 'WICI_RECOVERY_DUPLICATE_JOURNAL_LINE_REQUIRES_FINANCE_REVIEW';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entries'::regclass AND conname='journal_entries_journal_reference_key') THEN
  ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_journal_reference_key UNIQUE(journal_reference);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.journal_entry_lines'::regclass AND conname='journal_entry_lines_journal_entry_id_line_no_key') THEN
  ALTER TABLE public.journal_entry_lines ADD CONSTRAINT journal_entry_lines_journal_entry_id_line_no_key UNIQUE(journal_entry_id,line_no);
 END IF;
END $$;
-- Preserve audit and financial source rows when parents are deleted. No rows
-- or recorded money are rewritten. Existing valid references remain validated.
ALTER TABLE public.audit_registry_entries DROP CONSTRAINT audit_registry_entries_request_id_fkey;
ALTER TABLE public.audit_registry_entries ADD CONSTRAINT audit_registry_entries_request_id_fkey FOREIGN KEY(request_id) REFERENCES public.requests(id) ON DELETE RESTRICT;
ALTER TABLE public.contract_payments DROP CONSTRAINT contract_payments_contract_id_fkey;
ALTER TABLE public.contract_payments ADD CONSTRAINT contract_payments_contract_id_fkey FOREIGN KEY(contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT;
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_request_id_fkey;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_request_id_fkey FOREIGN KEY(request_id) REFERENCES public.requests(id) ON DELETE RESTRICT;
ALTER TABLE public.notification_outbox DROP CONSTRAINT notification_outbox_recipient_user_id_fkey;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_recipient_user_id_fkey FOREIGN KEY(recipient_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_outbox'::regclass AND conname='wici_recovery_retry_count_nonnegative') THEN
  ALTER TABLE public.notification_outbox ADD CONSTRAINT wici_recovery_retry_count_nonnegative CHECK(retry_count>=0) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.procurement_value_events'::regclass AND conname='wici_recovery_cost_avoidance_evidence') THEN
  ALTER TABLE public.procurement_value_events ADD CONSTRAINT wici_recovery_cost_avoidance_evidence CHECK(value_type<>'COST_AVOIDANCE' OR (verified_value>=0 AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND notes IS NOT NULL AND length(btrim(notes))>0)) NOT VALID;
 END IF;
END $$;
-- An extra hosted legacy trigger attempts direct stock balance updates when a
-- catalog proposal is approved. Contain it; never replay or reverse old effects.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.stock_item_requests'::regclass AND tgname='trg_approve_stock_item_request') THEN
  ALTER TABLE public.stock_item_requests DISABLE TRIGGER trg_approve_stock_item_request;
 END IF;
END $$;
-- Match the server-authorized architecture; preserve all RLS flags/policies.
REVOKE CREATE ON SCHEMA public FROM PUBLIC,purchase_backend;
DO $extension_visibility$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='extensions') THEN
  REVOKE CREATE ON SCHEMA extensions FROM PUBLIC,purchase_backend;
  GRANT USAGE ON SCHEMA extensions TO purchase_backend;
 END IF;
END $extension_visibility$;
DO $$ DECLARE object record; browser text; BEGIN
 FOR object IN SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',object.relname);
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',object.relname,browser); END IF;
  END LOOP;
  IF object.relname=ANY(ARRAY['audit_log','item_attribute_templates','item_uom_conversions','phase2_approval_active_repairs','stock_item_attribute_suggestions','workflow_idempotency_keys']) THEN
   IF object.relkind IN ('v','m') THEN EXECUTE format('GRANT SELECT ON TABLE public.%I TO purchase_backend',object.relname);
   ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO purchase_backend',object.relname); END IF;
  END IF;
 END LOOP;
 GRANT SELECT,INSERT,UPDATE,DELETE ON public.contract_financial_reviews TO purchase_backend;
 FOR object IN SELECT p.proname,p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' LOOP
  IF object.proname=ANY(ARRAY['preserve_contract_financial_reviews','canonical_supply_line_quantity','scop_preserve_evidence','scop_guard_profile','scop_guard_allocation','approve_stock_item_request','set_user_registration_requests_updated_at','wici_journal_identifier_aliases','wici_journal_line_identifier_aliases']) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',object.signature);
   FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',object.signature,browser); END IF;
   END LOOP;
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO purchase_backend',object.signature);
 END LOOP;
 FOR object IN SELECT c.oid::regclass AS sequence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' LOOP
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO purchase_backend',object.sequence);
 END LOOP;
END $$;
COMMIT;
