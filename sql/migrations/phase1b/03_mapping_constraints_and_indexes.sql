BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE UNIQUE INDEX IF NOT EXISTS stock_item_one_active_final_mapping_idx ON stock_item_master_mappings(stock_item_id) WHERE active AND mapping_status='approved';
CREATE INDEX IF NOT EXISTS stock_mapping_review_queue_idx ON stock_item_master_mappings(mapping_status,confidence_score DESC);
CREATE INDEX IF NOT EXISTS stock_mapping_stock_idx ON stock_item_master_mappings(stock_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS stock_staging_source_idx ON stock_item_migration_staging(source_stock_item_id,imported_at DESC);
-- For a very large production stock_items table, create these CONCURRENTLY in a separately scheduled, non-transactional maintenance step.
CREATE INDEX IF NOT EXISTS stock_items_generic_identity_idx ON stock_items(generic_item_id) WHERE generic_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_items_product_identity_idx ON stock_items(approved_product_id) WHERE approved_product_id IS NOT NULL;
CREATE OR REPLACE FUNCTION validate_stock_mapping_target() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p RECORD; g RECORD; BEGIN
 IF NEW.generic_item_id IS NULL AND NEW.mapping_status='approved' THEN RAISE EXCEPTION 'approved mapping requires generic item'; END IF;
 IF NEW.generic_item_id IS NOT NULL THEN SELECT lifecycle_status,is_active INTO g FROM generic_items WHERE id=NEW.generic_item_id; IF NOT FOUND OR g.lifecycle_status<>'active' OR NOT g.is_active THEN RAISE EXCEPTION 'generic item must be active'; END IF; END IF;
 IF NEW.approved_product_id IS NOT NULL THEN SELECT generic_item_id,approval_status,is_active INTO p FROM approved_products WHERE id=NEW.approved_product_id; IF NOT FOUND OR p.generic_item_id<>NEW.generic_item_id OR p.approval_status<>'approved' OR NOT p.is_active THEN RAISE EXCEPTION 'approved product is invalid or belongs to another generic item'; END IF; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS validate_stock_mapping_target_trigger ON stock_item_master_mappings;
CREATE TRIGGER validate_stock_mapping_target_trigger BEFORE INSERT OR UPDATE OF generic_item_id,approved_product_id,mapping_status ON stock_item_master_mappings FOR EACH ROW EXECUTE FUNCTION validate_stock_mapping_target();
COMMIT;