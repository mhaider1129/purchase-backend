CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES public.suppliers(id),
  supplier_name TEXT,
  expected_delivery_date DATE,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'PO_DRAFT',
  issued_by INTEGER REFERENCES public.users(id),
  issued_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  requested_item_id INTEGER REFERENCES public.requested_items(id),
  item_name TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoiced_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id);
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id);

CREATE TABLE IF NOT EXISTS public.ap_payables (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  supplier_invoice_id BIGINT NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  invoice_total NUMERIC(14,2) NOT NULL,
  open_balance NUMERIC(14,2) NOT NULL,
  due_date DATE,
  payable_status TEXT NOT NULL DEFAULT 'OPEN',
  posted_by INTEGER REFERENCES public.users(id),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id BIGSERIAL PRIMARY KEY,
  payment_record_id BIGINT NOT NULL REFERENCES public.payment_records(id) ON DELETE CASCADE,
  ap_payable_id BIGINT NOT NULL REFERENCES public.ap_payables(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.document_flow_links (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  source_document_type TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  target_document_type TEXT NOT NULL,
  target_document_id TEXT NOT NULL,
  metadata JSONB,
  created_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_request_id ON public.purchase_orders(request_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_ap_payables_request_id ON public.ap_payables(request_id);
CREATE INDEX IF NOT EXISTS idx_document_flow_links_request_id ON public.document_flow_links(request_id);