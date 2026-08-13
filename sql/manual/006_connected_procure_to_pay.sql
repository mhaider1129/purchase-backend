-- MANUAL ONLY. Phase 4 connected P2P additive migration. Do not execute without DBA review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Fail closed: the checked-in P2P foundation is authoritative; never create parallel base tables.
DO $$
DECLARE required text; missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH required IN ARRAY ARRAY['requests','requested_items','suppliers','users','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','supplier_invoices','invoice_items','invoice_match_results','payment_records','budget_envelopes','commitment_ledger','contracts','rfx_events','rfx_responses'] LOOP
    IF to_regclass('public.' || required) IS NULL THEN missing := array_append(missing, required); END IF;
  END LOOP;
  IF cardinality(missing) > 0 THEN RAISE EXCEPTION 'Phase 4 prerequisites missing: %', array_to_string(missing, ', '); END IF;
END $$;

-- Preflight diagnostics: abort rather than applying constraints over ambiguous legacy data.
DO $$
DECLARE
 duplicate_found boolean;
 legacy_award_found boolean := false;
 legacy_column text;
BEGIN
 -- request_id is nullable in the checked-in legacy schema. A NULL request_id is
 -- an unlinked legacy row, not a dangling foreign key and does not prevent this
 -- additive migration. Fail only when a non-NULL reference has no parent.
 IF EXISTS (SELECT 1 FROM public.requested_items ri LEFT JOIN public.requests r ON r.id=ri.request_id WHERE ri.request_id IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Preflight: requested_items rows reference missing requests'; END IF;
 IF EXISTS (SELECT 1 FROM public.requested_items WHERE request_id IS NULL) THEN RAISE NOTICE 'Preflight: unlinked legacy requested_items rows found; excluded from connected P2P until linked to a request'; END IF;
 -- supplier_id is nullable on the legacy purchase_orders table and SQL 006 does
 -- not add a NOT NULL constraint. Preserve draft/historical rows rather than
 -- guessing a supplier. Canonical issue/invoice services reject unusable POs.
 IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE supplier_id IS NULL) THEN RAISE NOTICE 'Preflight: legacy purchase_orders with NULL supplier_id found; they remain ineligible for connected issue and invoicing until governed and linked'; END IF;
 IF EXISTS (SELECT 1 FROM public.purchase_orders po LEFT JOIN public.suppliers s ON s.id=po.supplier_id WHERE po.supplier_id IS NOT NULL AND s.id IS NULL) THEN RAISE EXCEPTION 'Preflight: purchase_orders rows reference missing suppliers'; END IF;
 IF EXISTS (SELECT 1 FROM public.supplier_invoices WHERE supplier_id IS NOT NULL GROUP BY supplier_id, lower(btrim(invoice_number)) HAVING count(*) > 1) THEN RAISE EXCEPTION 'Preflight: duplicate supplier invoice identities'; END IF;
 IF EXISTS (SELECT 1 FROM public.supplier_invoices si LEFT JOIN public.purchase_orders po ON po.id=si.purchase_order_id WHERE si.purchase_order_id IS NOT NULL AND po.id IS NULL) THEN RAISE EXCEPTION 'Preflight: orphan supplier invoice purchase-order links'; END IF;
 IF EXISTS (SELECT 1 FROM public.invoice_items ii LEFT JOIN public.supplier_invoices si ON si.id=ii.supplier_invoice_id WHERE si.id IS NULL) THEN RAISE EXCEPTION 'Preflight: orphan invoice items'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='idempotency_key') THEN EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.supplier_invoices WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1)' INTO duplicate_found; IF duplicate_found THEN RAISE EXCEPTION 'Preflight: duplicate invoice idempotency keys'; END IF; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_records' AND column_name='idempotency_key') THEN EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.payment_records WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1)' INTO duplicate_found; IF duplicate_found THEN RAISE EXCEPTION 'Preflight: duplicate payment idempotency keys'; END IF; END IF;
 IF to_regclass('public.ap_payables') IS NOT NULL AND EXISTS (SELECT 1 FROM public.ap_payables WHERE open_balance < 0 OR open_balance > invoice_total) THEN RAISE EXCEPTION 'Preflight: invalid payable open balances'; END IF;
 IF to_regclass('public.ap_payables') IS NOT NULL AND EXISTS (SELECT 1 FROM public.ap_payables WHERE payable_status IN ('OPEN','PARTIALLY_PAID') GROUP BY supplier_invoice_id HAVING count(*) > 1) THEN RAISE EXCEPTION 'Preflight: duplicate active AP payables per invoice'; END IF;
 IF to_regclass('public.finance_postings') IS NOT NULL AND EXISTS (SELECT 1 FROM public.finance_postings fp LEFT JOIN public.ap_vouchers av ON av.id=fp.ap_voucher_id WHERE fp.ap_voucher_id IS NOT NULL AND av.id IS NULL) THEN RAISE EXCEPTION 'Preflight: orphan finance postings'; END IF;
 IF to_regclass('public.payment_allocations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.ap_payables ap LEFT JOIN LATERAL (SELECT COALESCE(SUM(pa.amount),0) paid FROM public.payment_allocations pa JOIN public.payment_records pr ON pr.id=pa.payment_record_id WHERE pa.ap_payable_id=ap.id AND pr.payment_status='paid') p ON TRUE WHERE p.paid > ap.invoice_total) THEN RAISE EXCEPTION 'Preflight: allocated payments exceed invoice totals'; END IF;
 IF EXISTS (SELECT 1 FROM public.payment_records pr WHERE pr.payment_status='paid' AND NOT EXISTS (SELECT 1 FROM public.payment_allocations pa WHERE pa.payment_record_id=pr.id)) THEN RAISE EXCEPTION 'Preflight: historical status-only PAID payment records require reconciliation'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='goods_receipts' AND column_name='idempotency_key') THEN EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.goods_receipts WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1)' INTO duplicate_found; IF duplicate_found THEN RAISE EXCEPTION 'Preflight: duplicate goods receipt idempotency keys'; END IF; END IF;
 IF EXISTS (SELECT 1 FROM public.goods_receipts WHERE receipt_number IS NOT NULL GROUP BY receipt_number HAVING count(*) > 1) THEN RAISE EXCEPTION 'Preflight: duplicate goods receipt numbers'; END IF;
 -- Schema generations differ: unit_cost may exist while supplier_name may not.
 -- Resolve optional legacy columns through the catalog and dynamic SQL so the
 -- parser never binds a column absent from the target database.
 FOR legacy_column IN
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='requested_items'
     AND column_name IN ('supplier_name','unit_cost')
 LOOP
   EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.requested_items WHERE %I IS NOT NULL)', legacy_column)
     INTO duplicate_found;
   legacy_award_found := legacy_award_found OR duplicate_found;
 END LOOP;
 IF legacy_award_found THEN RAISE NOTICE 'Preflight: populated legacy award-like requested_items fields require reconciliation'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='budget_envelopes' AND column_name IN ('allocated_amount','consumed_amount') GROUP BY table_name HAVING count(*)=2) THEN RAISE EXCEPTION 'Preflight: incompatible budget_envelopes balance columns'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='commitment_ledger' AND column_name IN ('request_id','budget_envelope_id','stage','amount','currency','source_type','source_id','notes','actor_id') GROUP BY table_name HAVING count(*)=9) THEN RAISE EXCEPTION 'Preflight: incompatible commitment_ledger base columns'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='commitment_ledger' AND column_name IN ('commitment_type','status')) THEN RAISE EXCEPTION 'Preflight: incompatible commitment_ledger legacy columns found'; END IF;
 -- A prior reviewed run may already have created the Phase 4 awards table.
 -- Permit that state only when its complete application contract is present;
 -- do not silently accept an unrelated or partially-created relation.
 IF to_regclass('public.procurement_awards') IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='procurement_awards'
     AND column_name IN ('id','request_id','request_item_id','supplier_id','awarded_quantity','unit_price','currency','source_type','source_id','selection_reason','actor_id','awarded_at','status','idempotency_key','payload_fingerprint')
   GROUP BY table_name HAVING count(*)=15
 ) THEN RAISE EXCEPTION 'Preflight: existing procurement_awards relation is incompatible with SQL 006'; END IF;
END $$;

-- requests/requested_items/suppliers/users use INTEGER PKs; document tables use BIGINT PKs.
CREATE TABLE IF NOT EXISTS public.procurement_awards (
 id BIGSERIAL PRIMARY KEY,
 request_id INTEGER NOT NULL REFERENCES public.requests(id),
 request_item_id INTEGER NOT NULL REFERENCES public.requested_items(id),
 supplier_id INTEGER NOT NULL REFERENCES public.suppliers(id),
 awarded_quantity NUMERIC(18,4) NOT NULL CHECK (awarded_quantity > 0),
 unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0), currency VARCHAR(3) NOT NULL,
 source_type TEXT NOT NULL CHECK (source_type IN ('QUOTATION','CONTRACT','FRAMEWORK_AGREEMENT','DIRECT_PURCHASE','MANUAL_EXCEPTION')),
 source_id BIGINT, selection_reason TEXT NOT NULL, actor_id INTEGER REFERENCES public.users(id),
 awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','SUPERSEDED')),
 idempotency_key TEXT NOT NULL UNIQUE, payload_fingerprint CHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS procurement_awards_request_item_idx ON public.procurement_awards(request_item_id) WHERE status='ACTIVE';

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES public.requests(id);
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS request_item_id INTEGER REFERENCES public.requested_items(id);
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS award_id BIGINT REFERENCES public.procurement_awards(id);
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'NON_INVENTORY' CHECK (line_type IN ('INVENTORY','NON_INVENTORY','SERVICE','ASSET','MEDICAL_DEVICE'));
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS price_source_type TEXT;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS price_source_id BIGINT;
CREATE INDEX IF NOT EXISTS po_items_request_item_idx ON public.purchase_order_items(request_item_id);
CREATE INDEX IF NOT EXISTS po_items_award_idx ON public.purchase_order_items(award_id);

-- commitment_ledger is the existing authority; encumbrance rows participate in availability sums.
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id);
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ACTUALIZED','RELEASED','REVERSED'));
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS parent_commitment_id BIGINT REFERENCES public.commitment_ledger(id);
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS supplier_invoice_id BIGINT REFERENCES public.supplier_invoices(id);
ALTER TABLE public.commitment_ledger ADD COLUMN IF NOT EXISTS ap_voucher_id BIGINT REFERENCES public.ap_vouchers(id);
CREATE UNIQUE INDEX IF NOT EXISTS commitment_ledger_idempotency_uq ON public.commitment_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_po_commitment_idx ON public.commitment_ledger(purchase_order_id) WHERE stage='encumbrance' AND state='ACTIVE';

-- purchase_order_id is the canonical existing PO FK (never po_id).
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS normalized_invoice_number TEXT;
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS payload_fingerprint CHAR(64);
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'AP_INVOICE_SUBMITTED';
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE public.supplier_invoices SET normalized_invoice_number=lower(btrim(invoice_number)) WHERE normalized_invoice_number IS NULL;
ALTER TABLE public.supplier_invoices ALTER COLUMN normalized_invoice_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_identity_uq ON public.supplier_invoices(supplier_id, normalized_invoice_number) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_idempotency_uq ON public.supplier_invoices(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES public.purchase_order_items(id);
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoice_match_results ADD COLUMN IF NOT EXISTS variances JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS public.invoice_match_override_decisions (
 id BIGSERIAL PRIMARY KEY, invoice_match_result_id BIGINT NOT NULL REFERENCES public.invoice_match_results(id),
 decision TEXT NOT NULL CHECK (decision IN ('APPROVED','DECLINED')), reason TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES public.users(id), original_variances JSONB NOT NULL,
 decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_match_history_idx ON public.invoice_match_results(supplier_invoice_id,matched_at DESC);
CREATE INDEX IF NOT EXISTS invoice_match_override_history_idx ON public.invoice_match_override_decisions(invoice_match_result_id,decided_at DESC,id DESC);

ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS supplier_invoice_id BIGINT REFERENCES public.supplier_invoices(id);
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS reversal_of_payment_id BIGINT REFERENCES public.payment_records(id);
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS payload_fingerprint CHAR(64);
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
ALTER TABLE public.ap_vouchers ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.ap_vouchers ADD COLUMN IF NOT EXISTS payload_fingerprint CHAR(64);
ALTER TABLE public.ap_payables ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
CREATE UNIQUE INDEX IF NOT EXISTS ap_voucher_idempotency_uq ON public.ap_vouchers(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_payable_per_invoice_uq ON public.ap_payables(supplier_invoice_id) WHERE payable_status IN ('OPEN','PARTIALLY_PAID');
CREATE INDEX IF NOT EXISTS payment_allocation_payable_idx ON public.payment_allocations(ap_payable_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_uq ON public.payment_records(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS payload_fingerprint CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_idempotency_uq ON public.goods_receipts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_number_uq ON public.goods_receipts(receipt_number) WHERE receipt_number IS NOT NULL;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES public.purchase_order_items(id);
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS lot_number TEXT;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES public.warehouses(id);
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (stock_status IN ('AVAILABLE','QUARANTINE','DAMAGED','EXPIRED','RECALLED','BLOCKED'));
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS source_uom TEXT;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS base_uom TEXT;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS stock_item_id BIGINT REFERENCES public.stock_items(id);
CREATE INDEX IF NOT EXISTS goods_receipt_items_po_line_idx ON public.goods_receipt_items(purchase_order_item_id);

-- Partial award conversion is intentional: do not make award_id unique. The
-- covering index supports the locked award -> active PO quantity calculation.
CREATE INDEX IF NOT EXISTS po_items_award_quantity_idx
  ON public.purchase_order_items (award_id, purchase_order_id)
  INCLUDE (quantity);

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='goods_receipt_idempotency_uq') THEN RAISE EXCEPTION 'Post-validation: goods receipt idempotency index missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='goods_receipts' AND column_name='payload_fingerprint') THEN RAISE EXCEPTION 'Post-validation: receipt payload fingerprint missing'; END IF;
END $$;
COMMIT;