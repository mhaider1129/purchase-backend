BEGIN;

-- Migration order: apply after the legacy Item Master/reference tables and core
-- procurement/warehouse schema. Run the companion verify SQL before and after.
ALTER TABLE item_manufacturers ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE item_manufacturers ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE item_manufacturers ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE item_manufacturers ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
UPDATE item_manufacturers SET normalized_name=LOWER(REGEXP_REPLACE(TRIM(manufacturer_name),'\s+',' ','g')) WHERE normalized_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS item_manufacturers_normalized_name_idx ON item_manufacturers(normalized_name);
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS normalized_uom_code TEXT;
UPDATE item_uom SET normalized_uom_code=UPPER(REGEXP_REPLACE(TRIM(uom_code),'[^A-Za-z0-9]','','g')) WHERE normalized_uom_code IS NULL;

CREATE TABLE IF NOT EXISTS generic_items (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  generic_name TEXT NOT NULL,
  canonical_description TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  item_type TEXT NOT NULL,
  specification JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_uom TEXT NOT NULL,
  inventory_uom TEXT NOT NULL,
  purchasing_uom TEXT,
  conversion_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  criticality TEXT NOT NULL DEFAULT 'routine' CHECK (criticality IN ('routine','essential','critical','life_sustaining')),
  hazard_information JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_sterile BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  batch_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  serial_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','review','validation','approval','active','retired')),
  standardization_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (standardization_status IN ('unreviewed','standard','restricted','exception')),
  interchangeability_policy TEXT NOT NULL DEFAULT 'approval_required' CHECK (interchangeability_policy IN ('fully_interchangeable','conditionally_interchangeable','non_interchangeable','proprietary','approval_required')),
  is_proprietary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  structured_fingerprint TEXT NOT NULL,
  category_id INTEGER REFERENCES item_categories(id) ON DELETE RESTRICT,
  base_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT,
  inventory_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT,
  purchasing_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  CHECK (NOT is_proprietary OR interchangeability_policy = 'proprietary'),
  CHECK (is_active = (lifecycle_status = 'active'))
);

CREATE INDEX IF NOT EXISTS generic_items_search_idx ON generic_items USING GIN
  (to_tsvector('simple', item_code || ' ' || generic_name || ' ' || canonical_description));
CREATE INDEX IF NOT EXISTS generic_items_fingerprint_idx ON generic_items (structured_fingerprint);
CREATE INDEX IF NOT EXISTS generic_items_filters_idx ON generic_items (lifecycle_status, category, item_type);

CREATE TABLE IF NOT EXISTS approved_products (
  id BIGSERIAL PRIMARY KEY,
  generic_item_id BIGINT NOT NULL REFERENCES generic_items(id) ON DELETE RESTRICT,
  product_identifier TEXT,
  manufacturer TEXT NOT NULL,
  manufacturer_id INTEGER REFERENCES item_manufacturers(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  product_description TEXT,
  manufacturer_part_number TEXT NOT NULL,
  normalized_manufacturer_part_number TEXT NOT NULL,
  model TEXT,
  technical_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  package_configuration TEXT,
  package_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_quantity > 0),
  product_uom TEXT NOT NULL,
  product_uom_id INTEGER REFERENCES item_uom(id) ON DELETE RESTRICT,
  inventory_conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (inventory_conversion_factor > 0),
  regulatory_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','pending','approved','rejected','retired')),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  technical_notes TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  UNIQUE (manufacturer_id, normalized_manufacturer_part_number),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS approved_products_generic_idx ON approved_products (generic_item_id, approval_status);
CREATE INDEX IF NOT EXISTS approved_products_identifier_idx ON approved_products (product_identifier) WHERE product_identifier IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_catalog_items (
  id BIGSERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  approved_product_id BIGINT NOT NULL REFERENCES approved_products(id) ON DELETE RESTRICT,
  supplier_item_code TEXT NOT NULL,
  supplier_description TEXT,
  purchasing_uom TEXT NOT NULL,
  conversion_factor NUMERIC(18,6) NOT NULL CHECK (conversion_factor > 0),
  package_size NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (package_size > 0),
  minimum_order_quantity NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  order_multiple NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (order_multiple > 0),
  unit_price NUMERIC(18,6) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency CHAR(3),
  tax_rate NUMERIC(7,4) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown','available','limited','unavailable','discontinued')),
  is_preferred_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_item_code),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS supplier_catalog_product_idx ON supplier_catalog_items (approved_product_id, is_active);
CREATE INDEX IF NOT EXISTS supplier_catalog_commercial_idx ON supplier_catalog_items (supplier_id, currency, unit_price);

CREATE TABLE IF NOT EXISTS pending_item_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  requested_item_id INTEGER REFERENCES requested_items(id) ON DELETE SET NULL,
  proposed_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  category TEXT,
  required_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  intended_use TEXT NOT NULL,
  requested_quantity NUMERIC(18,6) CHECK (requested_quantity IS NULL OR requested_quantity > 0),
  requested_uom TEXT,
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','review','needs_information','mapped_existing','approved_exception','rejected','resolved')),
  resolution_type TEXT CHECK (resolution_type IS NULL OR resolution_type IN ('existing_generic','existing_product','supplier_catalog_only','new_generic_draft','approved_free_text_exception','rejected','needs_information')),
  resolved_generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT,
  resolved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  assigned_steward_id INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pending_item_queue_idx ON pending_item_requests (status, created_at);

CREATE TABLE IF NOT EXISTS item_duplicate_reviews (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('generic_item','approved_product','supplier_catalog_item')),
  source_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  score NUMERIC(5,4) NOT NULL CHECK (score >= 0 AND score <= 1),
  matching_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','duplicate','not_duplicate','merged')),
  reviewed_by INTEGER REFERENCES users(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (entity_type, source_id, candidate_id),
  CHECK (source_id <> candidate_id)
);
CREATE INDEX IF NOT EXISTS item_duplicate_review_queue_idx ON item_duplicate_reviews (entity_type, decision);

CREATE TABLE IF NOT EXISTS item_master_aliases (
  id BIGSERIAL PRIMARY KEY,
  generic_item_id BIGINT NOT NULL REFERENCES generic_items(id) ON DELETE RESTRICT,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('legacy_name','legacy_code','request_snapshot','merged_item')),
  alias_value TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source_table TEXT,
  source_id BIGINT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generic_item_id, alias_type, normalized_alias)
);

CREATE TABLE IF NOT EXISTS legacy_item_mappings (
  id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL CHECK (source_table IN ('item_master','item_master_items')),
  legacy_item_id BIGINT NOT NULL,
  generic_item_id BIGINT NOT NULL REFERENCES generic_items(id) ON DELETE RESTRICT,
  legacy_code_snapshot TEXT,
  legacy_name_snapshot TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'active' CHECK (mapping_status IN ('active','superseded','rejected')),
  mapping_reason TEXT NOT NULL,
  mapped_by INTEGER NOT NULL REFERENCES users(id),
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_item_active_mapping_idx
  ON legacy_item_mappings (source_table, legacy_item_id) WHERE mapping_status='active';

CREATE TABLE IF NOT EXISTS generic_item_merges (
  id BIGSERIAL PRIMARY KEY,
  source_generic_item_id BIGINT NOT NULL REFERENCES generic_items(id) ON DELETE RESTRICT,
  target_generic_item_id BIGINT NOT NULL REFERENCES generic_items(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'merge_pending' CHECK (status IN ('merge_pending','completed','rejected')),
  merge_reason TEXT NOT NULL,
  conflict_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (source_generic_item_id <> target_generic_item_id)
);

CREATE TABLE IF NOT EXISTS item_master_audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  reason TEXT,
  previous_values JSONB,
  new_values JSONB,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  requested_item_id INTEGER REFERENCES requested_items(id) ON DELETE SET NULL,
  source_id BIGINT,
  target_id BIGINT,
  organizational_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS preferred_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS mandatory_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS request_mode TEXT DEFAULT 'approved_free_text_exception';
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS catalog_status TEXT DEFAULT 'approved_exception';
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS stocking_policy TEXT DEFAULT 'non_stock';
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS preferred_product_reason TEXT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS restriction_justification TEXT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS required_date DATE;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS item_name_snapshot TEXT;
ALTER TABLE requested_items ADD COLUMN IF NOT EXISTS canonical_description_snapshot TEXT;
DO $$ BEGIN
  ALTER TABLE requested_items ADD CONSTRAINT requested_items_request_mode_check CHECK
    (request_mode IN ('generic_item','generic_item_with_preference','specific_approved_product','service','pending_item_creation','approved_free_text_exception'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE requested_items ADD CONSTRAINT requested_items_catalog_status_check CHECK
    (catalog_status IN ('catalogued','pending_mapping','approved_exception'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE requested_items ADD CONSTRAINT requested_items_stocking_policy_check CHECK
    (stocking_policy IN ('stock','non_stock','consignment','direct_delivery','service'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS supplier_catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT;
ALTER TABLE warehouse_stock_levels ADD COLUMN IF NOT EXISTS generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT;

INSERT INTO permissions (code, name, description) VALUES
 ('item-master.create','Create generic items','Create governed generic item drafts'),
 ('item-master.edit','Edit generic items','Edit generic item master records'),
 ('item-master.validate','Validate generic items','Validate structured generic item master records'),
 ('item-master.retire','Retire generic items','Retire active generic items'),
 ('item-master.map','Resolve item mappings','Resolve pending and duplicate item mappings'),
 ('item-master.products','Manage approved products','Create and maintain approved products'),
 ('item-master.products.approve','Approve products','Approve exact manufactured products'),
 ('item-master.suppliers','Manage supplier catalog','Maintain commercial supplier catalog records')
 ,('item-master.legacy-maintain','Maintain legacy item mappings','Map compatibility item records to normalized generic items')
 ,('item-master.free-text-exception','Approve free-text exceptions','Authorize exceptional non-catalog purchase request lines')
ON CONFLICT (code) DO NOTHING;

COMMIT;