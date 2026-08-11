-- MANUAL ONLY. Phase 4 connected P2P additive migration. Do not run without backup/review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Preflight (review results before executing DDL):
-- SELECT id FROM requested_items WHERE quantity IS NULL OR quantity <= 0;
-- SELECT supplier_id, invoice_number, count(*) FROM supplier_invoices GROUP BY 1,2 HAVING count(*) > 1;
-- SELECT id FROM purchase_orders WHERE supplier_id IS NULL;

CREATE TABLE IF NOT EXISTS procurement_awards (
 id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES purchase_requests(id),
 request_item_id BIGINT NOT NULL REFERENCES requested_items(id), supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
 awarded_quantity NUMERIC(18,4) NOT NULL CHECK (awarded_quantity > 0), unit_price NUMERIC(18,4) NOT NULL CHECK (unit_price >= 0),
 currency VARCHAR(3) NOT NULL, tax_basis JSONB, discount_basis JSONB,
 source_type TEXT NOT NULL CHECK (source_type IN ('QUOTATION','CONTRACT','FRAMEWORK_AGREEMENT','DIRECT_PURCHASE','MANUAL_EXCEPTION')),
 source_id BIGINT, selection_reason TEXT NOT NULL, actor_id BIGINT REFERENCES users(id), awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','SUPERSEDED')),
 idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS procurement_awards_request_item_idx ON procurement_awards(request_item_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS procurement_awards_supplier_idx ON procurement_awards(supplier_id);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20,8) CHECK (exchange_rate > 0);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS base_currency_amount NUMERIC(18,2) CHECK (base_currency_amount >= 0);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS request_id BIGINT REFERENCES purchase_requests(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS request_item_id BIGINT REFERENCES requested_items(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS award_id BIGINT REFERENCES procurement_awards(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'NON_INVENTORY' CHECK (line_type IN ('INVENTORY','NON_INVENTORY','SERVICE','ASSET','MEDICAL_DEVICE'));
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS price_source_type TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS price_source_id BIGINT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0);
CREATE INDEX IF NOT EXISTS po_items_request_item_idx ON purchase_order_items(request_item_id);
CREATE INDEX IF NOT EXISTS po_items_award_idx ON purchase_order_items(award_id);

CREATE TABLE IF NOT EXISTS budget_commitments (
 id BIGSERIAL PRIMARY KEY, purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id), budget_envelope_id BIGINT NOT NULL REFERENCES budget_envelopes(id),
 amount NUMERIC(18,2) NOT NULL CHECK(amount >= 0), currency VARCHAR(3) NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('COMMITTED','PARTIALLY_ACTUALIZED','ACTUALIZED','RELEASED','REVERSED')),
 actualized_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(actualized_amount >= 0 AND actualized_amount <= amount),
 idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_po_commitment_idx ON budget_commitments(purchase_order_id) WHERE state IN ('COMMITTED','PARTIALLY_ACTUALIZED','ACTUALIZED');

ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id);
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES purchase_orders(id);
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_identity_uq ON supplier_invoices(supplier_id, lower(invoice_number)) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_idempotency_uq ON supplier_invoices(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES purchase_order_items(id);
ALTER TABLE invoice_match_results ADD COLUMN IF NOT EXISTS variances JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE invoice_match_results ADD COLUMN IF NOT EXISTS policy TEXT CHECK(policy IN ('TWO_WAY','THREE_WAY'));

ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS reversal_of_payment_id BIGINT REFERENCES payment_records(id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_uq ON payment_records(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_idempotency_uq ON goods_receipts(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS purchase_order_item_id BIGINT REFERENCES purchase_order_items(id);

-- Existing notification_outbox is reused; no duplicate outbox is created.
-- Post-validation:
-- SELECT conrelid::regclass, conname FROM pg_constraint WHERE conrelid IN ('procurement_awards'::regclass,'budget_commitments'::regclass);
-- SELECT indexname FROM pg_indexes WHERE indexname LIKE '%idempotency%' OR indexname='supplier_invoice_identity_uq';
COMMIT;
-- Rollback is forward/compensating only after writes begin. Dropping additive objects risks data loss and is intentionally omitted.