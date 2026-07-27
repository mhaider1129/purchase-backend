BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS stock_item_master_mappings (
 id BIGSERIAL PRIMARY KEY, stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
 generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT, approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT,
 mapping_status TEXT NOT NULL DEFAULT 'proposed' CHECK (mapping_status IN ('proposed','review_required','approved','rejected','superseded','rolled_back','duplicate','obsolete','excluded')),
 match_method TEXT NOT NULL, confidence_score NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1), proposed_generic_name TEXT,
 proposed_attributes JSONB NOT NULL DEFAULT '{}'::jsonb, candidate_details JSONB NOT NULL DEFAULT '[]'::jsonb,
 original_name_snapshot TEXT NOT NULL, original_description_snapshot TEXT, original_brand_snapshot TEXT, original_category_snapshot TEXT,
 original_subcategory_snapshot TEXT, original_uom_snapshot TEXT, previous_identity JSONB, review_notes TEXT,
 reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), active BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK (approved_product_id IS NULL OR generic_item_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS stock_item_migration_staging (
 id BIGSERIAL PRIMARY KEY, source_stock_item_id INTEGER NOT NULL, source_name TEXT NOT NULL, source_brand TEXT, source_category TEXT,
 source_subcategory TEXT, source_uom TEXT, source_description TEXT, source_quantity_snapshot NUMERIC, source_cost_snapshot NUMERIC,
 source_checksum TEXT NOT NULL, import_batch_id UUID NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 validation_status TEXT NOT NULL CHECK(validation_status IN ('valid','invalid','unchanged')), validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
 UNIQUE(source_stock_item_id, source_checksum)
);
CREATE TABLE IF NOT EXISTS item_attribute_templates (
 id BIGSERIAL PRIMARY KEY, category_id INTEGER REFERENCES item_categories(id) ON DELETE RESTRICT, category_key TEXT NOT NULL,
 attribute_key TEXT NOT NULL, label TEXT NOT NULL, data_type TEXT NOT NULL CHECK(data_type IN ('text','number','boolean','controlled','measurement')),
 controlled_values JSONB NOT NULL DEFAULT '[]'::jsonb, required BOOLEAN NOT NULL DEFAULT false, identity_significance NUMERIC(3,2) NOT NULL DEFAULT 0,
 duplicate_match_significance NUMERIC(3,2) NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0, validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
 active BOOLEAN NOT NULL DEFAULT true, UNIQUE(category_key,attribute_key)
);
CREATE TABLE IF NOT EXISTS stock_item_attribute_suggestions (
 id BIGSERIAL PRIMARY KEY, mapping_id BIGINT NOT NULL REFERENCES stock_item_master_mappings(id) ON DELETE RESTRICT,
 attribute_key TEXT NOT NULL, suggested_value JSONB NOT NULL, confidence NUMERIC(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 source_fragment TEXT NOT NULL, normalization_rule TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(mapping_id,attribute_key,normalization_rule)
);
INSERT INTO item_attribute_templates(category_key,attribute_key,label,data_type,controlled_values,required,identity_significance,duplicate_match_significance,display_order) VALUES
('surgical_sutures','absorbability','Absorbability','controlled','["absorbable","non_absorbable"]',true,1,1,10),
('surgical_sutures','material','Material','text','[]',true,1,1,20),('surgical_sutures','construction','Construction','controlled','["monofilament","braided","twisted"]',false,.8,.8,30),
('surgical_sutures','coating','Coating','text','[]',false,.5,.5,40),('surgical_sutures','color','Color','text','[]',false,.3,.3,50),
('surgical_sutures','suture_size','Suture size','text','[]',true,1,1,60),('surgical_sutures','strand_length','Strand length','measurement','[]',true,1,1,70),
('surgical_sutures','needle_presence','Needle presence','boolean','[]',true,.9,.9,80),('surgical_sutures','needle_type','Needle type','text','[]',false,.8,.8,90),
('surgical_sutures','needle_point','Needle point','text','[]',false,.8,.8,100),('surgical_sutures','needle_curvature','Needle curvature','text','[]',false,.8,.8,110),
('surgical_sutures','needle_length','Needle length','measurement','[]',false,.8,.8,120),('surgical_sutures','needle_count','Needle count','number','[]',false,.7,.7,130),
('surgical_sutures','sterility','Sterility','boolean','[]',true,.9,.9,140),('surgical_sutures','pack_configuration','Pack configuration','text','[]',false,.6,.6,150)
ON CONFLICT(category_key,attribute_key) DO NOTHING;
COMMIT;