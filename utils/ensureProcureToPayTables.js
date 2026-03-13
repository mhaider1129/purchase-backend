const pool = require('../config/db');

let ensured = false;

const statements = [
  `CREATE TABLE IF NOT EXISTS public.procurement_lifecycle_states (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE UNIQUE,
    procurement_state TEXT NOT NULL DEFAULT 'REQUEST_CREATED',
    finance_state TEXT NOT NULL DEFAULT 'draft',
    finance_match_policy TEXT NOT NULL DEFAULT 'THREE_WAY',
    payment_state TEXT NOT NULL DEFAULT 'unpaid',
    last_transition_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.procurement_state_history (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    from_state TEXT,
    to_state TEXT NOT NULL,
    changed_by INTEGER REFERENCES public.users(id),
    reason TEXT,
    metadata JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.goods_receipts (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    receipt_number TEXT,
    warehouse_location TEXT,
    received_by INTEGER NOT NULL REFERENCES public.users(id),
    received_at TIMESTAMPTZ NOT NULL,
    notes TEXT,
    discrepancy_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.goods_receipt_items (
    id BIGSERIAL PRIMARY KEY,
    goods_receipt_id BIGINT NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
    requested_item_id INTEGER REFERENCES public.requested_items(id),
    item_name TEXT NOT NULL,
    ordered_quantity NUMERIC(14,2),
    received_quantity NUMERIC(14,2) NOT NULL,
    damaged_quantity NUMERIC(14,2) DEFAULT 0,
    short_quantity NUMERIC(14,2) DEFAULT 0,
    unit_price NUMERIC(14,2),
    line_notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS public.supplier_invoices (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    supplier TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    invoice_date DATE NOT NULL,
    subtotal_amount NUMERIC(14,2) NOT NULL,
    tax_amount NUMERIC(14,2) DEFAULT 0,
    extra_charges NUMERIC(14,2) DEFAULT 0,
    total_amount NUMERIC(14,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    po_equivalent_number TEXT,
    receipt_id BIGINT REFERENCES public.goods_receipts(id),
    attachment_metadata JSONB,
    submitted_by INTEGER REFERENCES public.users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, invoice_number)
  )`,
  `CREATE TABLE IF NOT EXISTS public.invoice_items (
    id BIGSERIAL PRIMARY KEY,
    supplier_invoice_id BIGINT NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
    requested_item_id INTEGER REFERENCES public.requested_items(id),
    description TEXT NOT NULL,
    quantity NUMERIC(14,2) NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    line_total NUMERIC(14,2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS public.invoice_match_results (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    supplier_invoice_id BIGINT NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
    match_policy TEXT NOT NULL,
    match_status TEXT NOT NULL,
    mismatch_reasons JSONB,
    matched_by INTEGER REFERENCES public.users(id),
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    override_approved BOOLEAN NOT NULL DEFAULT FALSE,
    override_by INTEGER REFERENCES public.users(id),
    override_reason TEXT,
    override_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS public.ap_vouchers (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    supplier_invoice_id BIGINT REFERENCES public.supplier_invoices(id),
    voucher_number TEXT NOT NULL UNIQUE,
    voucher_status TEXT NOT NULL DEFAULT 'draft',
    currency TEXT DEFAULT 'USD',
    total_amount NUMERIC(14,2) NOT NULL,
    created_by INTEGER REFERENCES public.users(id),
    verified_by INTEGER REFERENCES public.users(id),
    posted_by INTEGER REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    voided_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS public.ap_voucher_lines (
    id BIGSERIAL PRIMARY KEY,
    ap_voucher_id BIGINT NOT NULL REFERENCES public.ap_vouchers(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    account_code TEXT,
    description TEXT NOT NULL,
    debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    reference_type TEXT,
    reference_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS public.finance_postings (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    ap_voucher_id BIGINT REFERENCES public.ap_vouchers(id),
    posting_status TEXT NOT NULL DEFAULT 'draft',
    posting_reference TEXT,
    liability_recognized_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    posted_by INTEGER REFERENCES public.users(id),
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.payment_records (
    id BIGSERIAL PRIMARY KEY,

    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    ap_voucher_id BIGINT REFERENCES public.ap_vouchers(id),
    payment_status TEXT NOT NULL DEFAULT 'payment_pending',
    payment_reference TEXT,
    payment_method TEXT,
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    paid_by INTEGER REFERENCES public.users(id),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.finance_action_history (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    actor_id INTEGER REFERENCES public.users(id),
    action_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_proc_state_history_request_id ON public.procurement_state_history(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_goods_receipts_request_id ON public.goods_receipts(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_invoices_request_id ON public.supplier_invoices(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_match_results_request_id ON public.invoice_match_results(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ap_vouchers_request_id ON public.ap_vouchers(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_postings_request_id ON public.finance_postings(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_records_request_id ON public.payment_records(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_action_history_request_id ON public.finance_action_history(request_id)`,
  `CREATE TABLE IF NOT EXISTS public.purchase_orders (
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
  )`,
  `CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    requested_item_id INTEGER REFERENCES public.requested_items(id),
    item_name TEXT NOT NULL,
    quantity NUMERIC(14,2) NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
    invoiced_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id)`,
  `ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id)`,
  `CREATE TABLE IF NOT EXISTS public.ap_payables (
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
  )`,
  `CREATE TABLE IF NOT EXISTS public.payment_allocations (
    id BIGSERIAL PRIMARY KEY,
    payment_record_id BIGINT NOT NULL REFERENCES public.payment_records(id) ON DELETE CASCADE,
    ap_payable_id BIGINT NOT NULL REFERENCES public.ap_payables(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS public.document_flow_links (
    id BIGSERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    source_document_type TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    target_document_type TEXT NOT NULL,
    target_document_id TEXT NOT NULL,
    metadata JSONB,
    created_by INTEGER REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_orders_request_id ON public.purchase_orders(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON public.purchase_order_items(purchase_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ap_payables_request_id ON public.ap_payables(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_document_flow_links_request_id ON public.document_flow_links(request_id)`
];

async function ensureProcureToPayTables(client = null) {
  if (ensured && !client) {
    return;
  }

  const runner = client || pool;
  for (const statement of statements) {
    await runner.query(statement);
  }

  if (!client) {
    ensured = true;
  }
}

module.exports = { ensureProcureToPayTables, procureToPayStatements: statements };