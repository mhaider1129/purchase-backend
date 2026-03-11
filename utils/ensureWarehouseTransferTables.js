const pool = require('../config/db');

let tablesEnsured = false;

const ensureWarehouseTransferTables = async (client = pool) => {
  if (tablesEnsured) return;

  const runner = client.query ? client : pool;

  const statements = [
    `CREATE TABLE IF NOT EXISTS public.warehouse_transfer_requests (
      id SERIAL PRIMARY KEY,
      origin_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      destination_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      status TEXT NOT NULL DEFAULT 'Pending',
      notes TEXT,
      requested_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      rejected_by INTEGER REFERENCES users(id),
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS public.warehouse_transfer_items (
      id SERIAL PRIMARY KEY,
      transfer_id INTEGER NOT NULL REFERENCES warehouse_transfer_requests(id) ON DELETE CASCADE,
      stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
      item_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      notes TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wtr_origin ON public.warehouse_transfer_requests(origin_warehouse_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wtr_destination ON public.warehouse_transfer_requests(destination_warehouse_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wtr_status ON public.warehouse_transfer_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_wti_transfer ON public.warehouse_transfer_items(transfer_id)`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  tablesEnsured = true;
};

module.exports = ensureWarehouseTransferTables;