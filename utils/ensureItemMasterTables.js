const pool = require('../config/db');

let ensurePromise = null;

const ensureItemMasterTables = async (client = pool) => {
  if (client !== pool) {
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