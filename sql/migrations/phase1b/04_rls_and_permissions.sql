BEGIN;
INSERT INTO permissions(code,name,description) VALUES
('item-master.stock-map','Map stock items','Review individual stock mappings'),('item-master.stock-map.bulk','Bulk map stock items','Approve safe homogeneous mapping batches'),
('item-master.stock-map.override','Override stock mappings','Supersede final mappings'),('item-master.stock-migration-maintain','Maintain stock migration','Import and maintain legacy staging'),
('inventory.add-from-master','Add inventory from Item Master','Create normalized inventory items'),('inventory.legacy-create','Create legacy inventory','Exceptional standalone legacy creation') ON CONFLICT(code) DO NOTHING;
ALTER TABLE stock_item_master_mappings ENABLE ROW LEVEL SECURITY; ALTER TABLE stock_item_migration_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_attribute_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE stock_item_attribute_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_item_master_mappings,stock_item_migration_staging,item_attribute_templates,stock_item_attribute_suggestions FROM anon,authenticated;
GRANT SELECT ON item_attribute_templates TO authenticated;
DROP POLICY IF EXISTS item_attribute_templates_authenticated_read ON item_attribute_templates;
CREATE POLICY item_attribute_templates_authenticated_read ON item_attribute_templates FOR SELECT TO authenticated USING(active);
-- Mapping/staging writes are backend-only; authorization is enforced by routes and the transaction service.
COMMIT;