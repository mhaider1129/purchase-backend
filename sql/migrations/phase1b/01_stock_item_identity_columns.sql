BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- stock_items.id is INTEGER in the repository schema. This migration never rewrites rows.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
-- Supplier offers remain on sourcing and purchasing lines. An inventory identity
-- is deliberately not coupled to one supplier catalog offer.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS inventory_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS mapping_status TEXT NOT NULL DEFAULT 'unmapped';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS mapped_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS mapping_notes TEXT;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS identity_source TEXT NOT NULL DEFAULT 'legacy_stock_item';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS legacy_identity_snapshot JSONB;
DO $$ BEGIN ALTER TABLE stock_items ADD CONSTRAINT stock_items_mapping_status_check CHECK (mapping_status IN ('unmapped','auto_matched','review_required','mapped_generic','mapped_product','duplicate','obsolete','excluded')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_items ADD CONSTRAINT stock_items_identity_source_check CHECK (identity_source IN ('normalized','legacy_stock_item','approved_exception')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_items ADD CONSTRAINT stock_items_product_requires_generic CHECK (approved_product_id IS NULL OR generic_item_id IS NOT NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;