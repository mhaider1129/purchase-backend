const pool = require('../config/db');

let ensured = false;
let ensuringPromise = null;

const ensureItemRecallsTable = async (client = pool) => {
  if (ensured) return;
  if (ensuringPromise) {
    await ensuringPromise;
    return;
  }

  const runner = client.query ? client : pool;

  ensuringPromise = (async () => {
    try {
      await runner.query(`
        CREATE TABLE IF NOT EXISTS item_recalls (
          id SERIAL PRIMARY KEY,
          item_id INTEGER REFERENCES stock_items(id) ON DELETE SET NULL,
          item_name TEXT NOT NULL,
          quantity NUMERIC,
          reason TEXT NOT NULL,
          notes TEXT,
          recall_notice TEXT,
          supplier_letters TEXT,
          ncr_reference TEXT,
          capa_reference TEXT,
          final_report TEXT,
          recall_type TEXT NOT NULL,
          status TEXT NOT NULL,
          department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
          initiated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          escalated_to_procurement BOOLEAN DEFAULT FALSE,
          escalated_at TIMESTAMPTZ,
          escalated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          warehouse_notes TEXT,
          lot_number TEXT,
          quarantine_active BOOLEAN DEFAULT FALSE,
          quarantine_reason TEXT,
          quarantine_started_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const statements = [
        `CREATE INDEX IF NOT EXISTS item_recalls_status_idx ON item_recalls (LOWER(status))`,
        `CREATE INDEX IF NOT EXISTS item_recalls_item_idx ON item_recalls (item_id)`,
        `CREATE INDEX IF NOT EXISTS item_recalls_item_name_idx ON item_recalls (LOWER(item_name))`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS lot_number TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS quarantine_active BOOLEAN DEFAULT FALSE`,
        `UPDATE item_recalls SET quarantine_active = COALESCE(quarantine_active, FALSE)`,
        `ALTER TABLE item_recalls ALTER COLUMN quarantine_active SET DEFAULT FALSE`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS quarantine_reason TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS quarantine_started_at TIMESTAMPTZ`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS recall_notice TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS supplier_letters TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS ncr_reference TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS capa_reference TEXT`,
        `ALTER TABLE item_recalls ADD COLUMN IF NOT EXISTS final_report TEXT`,
      ];

      for (const statement of statements) {
        await runner.query(statement);
      }
    } finally {
      ensured = true;
      ensuringPromise = null;
    }
  })();

  await ensuringPromise;
};

module.exports = ensureItemRecallsTable;