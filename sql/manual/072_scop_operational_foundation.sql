-- MANUAL DATABASE MIGRATION REQUIRED. Additive SCOP Phase 1; no historical enrollment/backfill.
-- Prerequisites: reviewed canonical 059/064-071 contracts and governed 071 execution receipt.
-- Apply the generated governed bundle manually, not the frozen migration collection.
BEGIN;
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
COMMIT;
