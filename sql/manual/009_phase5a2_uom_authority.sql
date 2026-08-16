-- PHASE 5A.2 MANUAL MIGRATION. Review and execute manually only.
-- MIGRATION BLOCKERS. Every statement before BEGIN is read-only; stop on any non-zero defect.
SELECT 'duplicate_uom_identity' check_name, COUNT(*) defect_count FROM (SELECT normalized_uom_code FROM item_uom GROUP BY normalized_uom_code HAVING COUNT(*)>1) d;
SELECT 'invalid_generic_uom_reference', COUNT(*) FROM generic_items g LEFT JOIN item_uom b ON b.id=g.base_uom_id LEFT JOIN item_uom i ON i.id=g.inventory_uom_id WHERE (g.base_uom_id IS NOT NULL AND b.id IS NULL) OR (g.inventory_uom_id IS NOT NULL AND i.id IS NULL);
SELECT 'nonpositive_product_package', COUNT(*) FROM approved_products WHERE package_quantity<=0 OR inventory_conversion_factor<=0;
SELECT 'nonpositive_supplier_conversion_or_rules', COUNT(*) FROM supplier_catalog_items WHERE conversion_factor<=0 OR package_size<=0 OR minimum_order_quantity<=0 OR order_multiple<=0;
SELECT 'supplier_uom_without_exact_code', COUNT(*) FROM supplier_catalog_items c LEFT JOIN item_uom u ON UPPER(TRIM(u.uom_code))=UPPER(TRIM(c.purchasing_uom)) WHERE u.id IS NULL;
SELECT 'generic_uom_text_id_mismatch', COUNT(*) FROM generic_items g LEFT JOIN item_uom b ON b.id=g.base_uom_id LEFT JOIN item_uom i ON i.id=g.inventory_uom_id WHERE (b.id IS NOT NULL AND UPPER(TRIM(g.base_uom))<>UPPER(TRIM(b.uom_code))) OR (i.id IS NOT NULL AND UPPER(TRIM(g.inventory_uom))<>UPPER(TRIM(i.uom_code)));
SELECT 'product_uom_text_id_mismatch', COUNT(*) FROM approved_products p JOIN item_uom u ON u.id=p.product_uom_id WHERE UPPER(TRIM(p.product_uom))<>UPPER(TRIM(u.uom_code));
SELECT 'stock_inventory_uom_missing', COUNT(*) FROM stock_items WHERE inventory_uom_id IS NULL;
SELECT 'gr_snapshot_missing', COUNT(*) FROM goods_receipt_items WHERE source_uom IS NULL OR base_uom IS NULL OR conversion_factor IS NULL;
SELECT 'inventory_snapshot_missing', COUNT(*) FROM inventory_transactions WHERE source_quantity IS NULL OR source_uom IS NULL OR base_uom IS NULL OR conversion_factor IS NULL;
SELECT 'duplicate_active_pending_referrals',COUNT(*) FROM (SELECT requested_item_id FROM pending_item_requests WHERE status IN ('submitted','review','needs_information') GROUP BY requested_item_id HAVING COUNT(*)>1) d;
SELECT 'approved_requests_pending_mapping',COUNT(*) FROM requested_items ri JOIN requests r ON r.id=ri.request_id WHERE LOWER(r.status) IN ('approved','assigned','completed') AND ri.catalog_status='pending_mapping';

-- HISTORICAL RECONCILIATION COUNTS (informational, never migration blockers).
SELECT 'historical_po_rows_requiring_snapshot_reconciliation' finding_name, COUNT(*) finding_count FROM purchase_order_items;

BEGIN;

ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS purchasing_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT;
ALTER TABLE rfx_response_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE rfx_response_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS rfx_response_items_product_idx ON rfx_response_items(approved_product_id);
CREATE INDEX IF NOT EXISTS rfx_response_items_catalog_idx ON rfx_response_items(supplier_catalog_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS pending_item_requests_one_active_per_item ON pending_item_requests(requested_item_id) WHERE requested_item_id IS NOT NULL AND status IN ('submitted','review','needs_information');
ALTER TABLE procurement_awards ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE procurement_awards ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS source_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS source_uom TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS base_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS base_uom TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_positive_conversion;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_positive_conversion CHECK (conversion_factor IS NULL OR conversion_factor > 0) NOT VALID;
CREATE INDEX IF NOT EXISTS supplier_catalog_items_purchasing_uom_id_idx ON supplier_catalog_items(purchasing_uom_id);

-- Universal conversions only. Application governance rejects packaging units;
-- this table deliberately has no Generic/Product/Catalog foreign key.
CREATE TABLE IF NOT EXISTS item_uom_conversions (
  id BIGSERIAL PRIMARY KEY,
  from_uom_id INTEGER NOT NULL REFERENCES item_uom(id) ON DELETE RESTRICT,
  to_uom_id INTEGER NOT NULL REFERENCES item_uom(id) ON DELETE RESTRICT,
  conversion_factor NUMERIC(30,12) NOT NULL CHECK (conversion_factor > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_uom_conversions_distinct CHECK (from_uom_id<>to_uom_id),
  CONSTRAINT item_uom_conversions_unique_direction UNIQUE(from_uom_id,to_uom_id)
);

COMMENT ON TABLE item_uom_conversions IS 'MIGRATION FOUNDATION / DEFERRED: not a runtime conversion authority in Phase 5A.2; universal dimensional conversions only.';
COMMENT ON COLUMN approved_products.package_quantity IS 'Generic base-UOM units per Product UOM.';
COMMENT ON COLUMN approved_products.inventory_conversion_factor IS 'Deprecated compatibility projection; equals package_quantity only when Generic base and inventory UOM identities are equal.';
COMMENT ON COLUMN generic_items.conversion_rules IS 'Deprecated legacy compatibility; not a conversion authority.';
COMMENT ON COLUMN generic_items.purchasing_uom IS 'Legacy/default display preference; Supplier Catalog purchasing UOM is authoritative.';
COMMENT ON COLUMN supplier_catalog_items.package_size IS 'Deprecated ambiguous metadata; not used in canonical arithmetic.';
COMMENT ON COLUMN supplier_catalog_items.conversion_factor IS 'Approved Product UOMs per Supplier Purchasing UOM.';
COMMENT ON COLUMN purchase_order_items.conversion_factor IS 'Immutable inventory-units-per-source-UOM snapshot at PO award.';

-- Safe mapping is exact controlled code only and is intentionally visible.
UPDATE supplier_catalog_items c SET purchasing_uom_id=u.id
FROM item_uom u JOIN (SELECT UPPER(TRIM(uom_code)) code FROM item_uom GROUP BY UPPER(TRIM(uom_code)) HAVING COUNT(*)=1) unique_code ON unique_code.code=UPPER(TRIM(u.uom_code))
WHERE c.purchasing_uom_id IS NULL AND UPPER(TRIM(c.purchasing_uom))=UPPER(TRIM(u.uom_code));

COMMIT;

-- Postflight reconciliation findings; do not make new fields NOT NULL until historical exceptions are resolved.
SELECT 'historical_governed_rfx_missing_product',COUNT(*) FROM rfx_response_items x JOIN requested_items ri ON ri.id=x.requested_item_id WHERE ri.request_mode NOT IN ('service','approved_free_text_exception') AND x.approved_product_id IS NULL;
SELECT 'historical_governed_rfx_missing_catalog',COUNT(*) FROM rfx_response_items x JOIN requested_items ri ON ri.id=x.requested_item_id WHERE ri.request_mode NOT IN ('service','approved_free_text_exception') AND x.supplier_catalog_item_id IS NULL;
SELECT 'supplier_uom_still_unmapped' check_name, COUNT(*) defect_count FROM supplier_catalog_items WHERE purchasing_uom_id IS NULL;
SELECT 'po_snapshot_still_missing', COUNT(*) FROM purchase_order_items WHERE source_uom IS NULL OR base_uom IS NULL OR conversion_factor IS NULL;