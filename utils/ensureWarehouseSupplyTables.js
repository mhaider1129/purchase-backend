const pool = require('../config/db');

let tablesEnsured = false;

const ensureWarehouseSupplyTables = async (client = pool) => {
  if (tablesEnsured) return;

  const runner = client.query ? client : pool;

  const statements = [
    `CREATE TABLE IF NOT EXISTS public.warehouse_supply_items (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      requested_item_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS public.warehouse_supplied_items (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES warehouse_supply_items(id) ON DELETE CASCADE,
      supplied_quantity INTEGER NOT NULL,
      supplied_by UUID REFERENCES users(id),
      supplied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wsi_request_id ON public.warehouse_supply_items(request_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wsup_request_id ON public.warehouse_supplied_items(request_id)`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  tablesEnsured = true;
};

module.exports = ensureWarehouseSupplyTables;