const pool = require('../config/db');

let ensurePromise = null;

const ensureItemMasterTables = async (client = pool) => {
  if (client !== pool) {

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_categories (
        id SERIAL PRIMARY KEY,
        category_name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_uom (
        id SERIAL PRIMARY KEY,
        uom_code TEXT NOT NULL UNIQUE,
        uom_name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_base_uom BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_manufacturers (
        id SERIAL PRIMARY KEY,
        manufacturer_name TEXT NOT NULL UNIQUE,
        country_of_origin TEXT,
        contact_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_brands (
        id SERIAL PRIMARY KEY,
        brand_name TEXT NOT NULL UNIQUE,
        manufacturer_id INTEGER REFERENCES item_manufacturers(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_master (
        id SERIAL PRIMARY KEY,
        item_code TEXT NOT NULL UNIQUE,
        item_name TEXT NOT NULL,
        generic_name TEXT,
        category_id INTEGER REFERENCES item_categories(id) ON DELETE SET NULL,
        base_uom_id INTEGER REFERENCES item_uom(id) ON DELETE SET NULL,
        manufacturer_id INTEGER REFERENCES item_manufacturers(id) ON DELETE SET NULL,
        brand_id INTEGER REFERENCES item_brands(id) ON DELETE SET NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('draft', 'active', 'inactive', 'archived'))
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_variants (
        id SERIAL PRIMARY KEY,
        item_master_id INTEGER NOT NULL REFERENCES item_master(id) ON DELETE CASCADE,
        variant_code TEXT UNIQUE,
        variant_name TEXT NOT NULL,
        sku TEXT UNIQUE,
        variant_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('active', 'inactive'))
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_conversion (
        id SERIAL PRIMARY KEY,
        item_master_id INTEGER REFERENCES item_master(id) ON DELETE CASCADE,
        from_uom_id INTEGER NOT NULL REFERENCES item_uom(id) ON DELETE CASCADE,
        to_uom_id INTEGER NOT NULL REFERENCES item_uom(id) ON DELETE CASCADE,
        conversion_factor NUMERIC(18,6) NOT NULL CHECK (conversion_factor > 0),
        is_bidirectional BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT item_conversion_unique UNIQUE (item_master_id, from_uom_id, to_uom_id),
        CHECK (from_uom_id <> to_uom_id)
      )
    `);

    await client.query(`
      ALTER TABLE stock_items
      ADD COLUMN IF NOT EXISTS item_master_id INTEGER REFERENCES item_master(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS item_variant_id INTEGER REFERENCES item_variants(id) ON DELETE SET NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_master_items (
        id SERIAL PRIMARY KEY,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        generic_name TEXT,
        brand_name TEXT,
        category TEXT NOT NULL,
        subcategory TEXT,
        item_classification TEXT NOT NULL,
        unit_of_measure TEXT NOT NULL,
        pack_size TEXT,
        specifications TEXT,
        storage_condition TEXT,
        batch_controlled BOOLEAN NOT NULL DEFAULT FALSE,
        expiry_controlled BOOLEAN NOT NULL DEFAULT FALSE,
        serial_controlled BOOLEAN NOT NULL DEFAULT FALSE,
        standard_cost NUMERIC(14,2),
        preferred_suppliers JSONB NOT NULL DEFAULT '[]'::jsonb,
        contract_eligibility BOOLEAN NOT NULL DEFAULT FALSE,
        reorder_level NUMERIC(14,2),
        safety_stock NUMERIC(14,2),
        institute_applicability JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'draft',
        submitted_by INTEGER REFERENCES users(id),
        submitted_at TIMESTAMP,
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('draft', 'pending_approval', 'active', 'rejected')),
        CHECK (item_classification IN (
          'medication',
          'medical_supply',
          'medical_device',
          'laboratory_item',
          'maintenance_spare_part',
          'it_item',
          'stationery',
          'general_item'
        ))
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_master_documents (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES item_master_items(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL,
        document_name TEXT NOT NULL,
        file_path TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (document_type IN (
          'catalogue',
          'coa_coc',
          'msds',
          'registration_certificate',
          'technical_datasheet'
        ))
      )
    `);

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_item_master_category ON item_master (category_id)'
    );

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_item_variants_master_id ON item_variants (item_master_id)'
    );

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_item_conversion_master_id ON item_conversion (item_master_id)'
    );

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_item_master_items_search ON item_master_items (LOWER(item_name), LOWER(generic_name), LOWER(brand_name), LOWER(item_code))'
    );

    return;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await ensureItemMasterTables({ query: (...args) => pool.query(...args) });
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
};

module.exports = ensureItemMasterTables;