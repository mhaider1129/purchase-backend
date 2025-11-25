const pool = require('../config/db');

let initialized = false;
let initializingPromise = null;

const ensureTechnicalInspectionsTable = async (client = pool) => {
  if (initialized) return;
  if (initializingPromise) {
    await initializingPromise;
    return;
  }

  const runner = client.query ? client : pool;

  initializingPromise = (async () => {
    try {
      await runner.query(`
        CREATE TABLE IF NOT EXISTS technical_inspections (
          id SERIAL PRIMARY KEY,
          inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
          location TEXT,
          item_name TEXT NOT NULL,
          item_category TEXT,
          model_number TEXT,
          serial_number TEXT,
          lot_number TEXT,
          manufacturer TEXT,
          supplier_name TEXT,
          general_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
          category_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          inspectors JSONB NOT NULL DEFAULT '[]'::jsonb,
          approvals JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await runner.query(`
        CREATE INDEX IF NOT EXISTS technical_inspections_item_name_idx
          ON technical_inspections (LOWER(item_name));
      `);

      await runner.query(`
        CREATE INDEX IF NOT EXISTS technical_inspections_supplier_idx
          ON technical_inspections (LOWER(supplier_name));
      `);

      await runner.query(`
        ALTER TABLE technical_inspections
          ADD COLUMN IF NOT EXISTS manufacturer TEXT,
          ADD COLUMN IF NOT EXISTS lot_number TEXT,
          ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS requested_item_id INTEGER REFERENCES requested_items(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS acceptance_status TEXT DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS acceptance_notes TEXT,
          ADD COLUMN IF NOT EXISTS acceptance_recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS acceptance_recorded_at TIMESTAMPTZ;
      `);

      await runner.query(
        "UPDATE technical_inspections SET acceptance_status = COALESCE(LOWER(TRIM(acceptance_status)), 'pending')",
      );
      await runner.query(
        "ALTER TABLE technical_inspections ALTER COLUMN acceptance_status SET DEFAULT 'pending'",
      );

      await runner.query(
        'CREATE INDEX IF NOT EXISTS technical_inspections_request_idx ON technical_inspections (request_id)',
      );
      await runner.query(
        'CREATE INDEX IF NOT EXISTS technical_inspections_requested_item_idx ON technical_inspections (requested_item_id)',
      );
    } finally {
      initializingPromise = null;
      initialized = true;
    }
  })();

  await initializingPromise;
};

module.exports = ensureTechnicalInspectionsTable;