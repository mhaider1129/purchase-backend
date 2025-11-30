const pool = require('../config/db');

let tablesEnsured = false;

const ensureWarehouseInventoryTables = async (client = pool) => {
  if (tablesEnsured) return;

  const runner = client.query ? client : pool;

  const statements = [
    `CREATE TABLE IF NOT EXISTS public.warehouse_stock_levels (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
      item_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (warehouse_id, stock_item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS public.warehouse_stock_movements (
      id SERIAL PRIMARY KEY,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      stock_item_id INTEGER REFERENCES stock_items(id),
      item_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      quantity NUMERIC NOT NULL,
      reference_request_id INTEGER REFERENCES requests(id),
      to_department_id INTEGER REFERENCES departments(id),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wsl_warehouse_item ON public.warehouse_stock_levels(warehouse_id, stock_item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wsm_direction_created ON public.warehouse_stock_movements(direction, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_wsm_department ON public.warehouse_stock_movements(to_department_id)`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  tablesEnsured = true;
};

module.exports = ensureWarehouseInventoryTables;