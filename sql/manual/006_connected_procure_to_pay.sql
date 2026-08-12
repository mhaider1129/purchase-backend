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
DO $$ DECLARE duplicate_found boolean; BEGIN
 IF EXISTS (SELECT 1 FROM public.requested_items ri LEFT JOIN public.requests r ON r.id=ri.request_id WHERE r.id IS NULL) THEN RAISE EXCEPTION 'Preflight: orphan requested_items.request_id rows'; END IF;
 IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE supplier_id IS NULL) THEN RAISE EXCEPTION 'Preflight: purchase_orders with NULL supplier_id'; END IF;
 IF EXISTS (SELECT 1 FROM public.supplier_invoices WHERE supplier_id IS NOT NULL GROUP BY supplier_id, lower(btrim(invoice_number)) HAVING count(*) > 1) THEN RAISE EXCEPTION 'Preflight: duplicate supplier invoice identities'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='idempotency_key') THEN EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.supplier_invoices WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1)' INTO duplicate_found; IF duplicate_found THEN RAISE EXCEPTION 'Preflight: duplicate invoice idempotency keys'; END IF; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_records' AND column_name='idempotency_key') THEN EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.payment_records WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1)' INTO duplicate_found; IF duplicate_found THEN RAISE EXCEPTION 'Preflight: duplicate payment idempotency keys'; END IF; END IF;
 IF EXISTS (SELECT 1 FROM public.requested_items WHERE supplier_name IS NOT NULL OR unit_cost IS NOT NULL) THEN RAISE NOTICE 'Preflight: legacy award-like requested_items fields require reconciliation'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='budget_envelopes' AND column_name IN ('allocated_amount','consumed_amount') GROUP BY table_name HAVING count(*)=2) THEN RAISE EXCEPTION 'Preflight: incompatible budget_envelopes balance columns'; END IF;
END $$;

-- requests/requested_items/suppliers/users use INTEGER PKs; document tables use BIGINT PKs.
CREATE TABLE public.procurement_awards (
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
CREATE INDEX procurement_awards_request_item_idx ON public.procurement_awards(request_item_id) WHERE status='ACTIVE';

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
CREATE UNIQUE INDEX IF NOT EXISTS commitment_ledger_idempotency_uq ON public.commitment_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_po_commitment_idx ON public.commitment_ledger(purchase_order_id) WHERE stage='encumbrance' AND state='ACTIVE';

-- purchase_order_id is the canonical existing PO FK (never po_id).
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_identity_uq ON public.supplier_invoices(supplier_id, lower(btrim(invoice_number))) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_idempotency_uq ON public.supplier_invoices(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES public.purchase_order_items(id);
ALTER TABLE public.invoice_match_results ADD COLUMN IF NOT EXISTS variances JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS supplier_invoice_id BIGINT REFERENCES public.supplier_invoices(id);
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS reversal_of_payment_id BIGINT REFERENCES public.payment_records(id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_uq ON public.payment_records(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_idempotency_uq ON public.goods_receipts(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.goods_receipt_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES public.purchase_order_items(id);

COMMIT;