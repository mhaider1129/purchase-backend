const pool = require('../config/db');

let tablesEnsured = false;
let tablesEnsuredPromise = null;


const ensureWarehouseInventoryTables = async (client = pool) => {
  if (tablesEnsured) return;
  if (!tablesEnsuredPromise) {
    tablesEnsuredPromise = (async () => {
      const runner = client.query ? client : pool;

      const statements = [
        `CREATE TABLE IF NOT EXISTS public.warehouse_stock_levels (
          id SERIAL PRIMARY KEY,
          warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
          stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
          batch_id INTEGER REFERENCES warehouse_item_batches(id),
          item_name TEXT NOT NULL,
          lot_number TEXT,
          expiry_date DATE,
          serial_number TEXT,
          quantity NUMERIC NOT NULL DEFAULT 0,
          updated_by INTEGER REFERENCES users(id),
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (warehouse_id, stock_item_id, batch_id, lot_number, expiry_date, serial_number)
        )`,
        `CREATE TABLE IF NOT EXISTS public.warehouse_stock_movements (
          id SERIAL PRIMARY KEY,
          warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
          stock_item_id INTEGER REFERENCES stock_items(id),
          batch_id INTEGER REFERENCES warehouse_item_batches(id),
          item_name TEXT NOT NULL,
          lot_number TEXT,
          expiry_date DATE,
          serial_number TEXT,
          direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
          quantity NUMERIC NOT NULL,
          reference_request_id INTEGER REFERENCES requests(id),
          reference_transfer_id INTEGER,
          to_department_id INTEGER REFERENCES departments(id),
          to_section_id INTEGER REFERENCES sections(id),
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS public.inventory_transactions (
          id SERIAL PRIMARY KEY,
          transaction_type TEXT NOT NULL CHECK (transaction_type IN ('warehouse', 'department', 'transfer', 'receipt', 'issue', 'adjustment', 'recall')),
          source_location TEXT,
          destination_location TEXT,
          warehouse_id INTEGER REFERENCES warehouses(id),
          department_id INTEGER REFERENCES departments(id),
          section_id INTEGER REFERENCES sections(id),
          batch_id INTEGER REFERENCES warehouse_item_batches(id),
          stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
          quantity NUMERIC NOT NULL,
          unit_cost NUMERIC,
          reference_document TEXT,
          reference_request_id INTEGER REFERENCES requests(id),
          reference_transfer_id INTEGER,
          warehouse_stock_movement_id INTEGER REFERENCES warehouse_stock_movements(id),
          department_stock_movement_id INTEGER REFERENCES department_stock_movements(id),
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS reference_transfer_id INTEGER`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS to_section_id INTEGER REFERENCES sections(id)`,
        `ALTER TABLE public.warehouse_stock_levels ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES warehouse_item_batches(id)`,
        `ALTER TABLE public.warehouse_stock_levels ADD COLUMN IF NOT EXISTS lot_number TEXT`,
        `ALTER TABLE public.warehouse_stock_levels ADD COLUMN IF NOT EXISTS expiry_date DATE`,
        `ALTER TABLE public.warehouse_stock_levels ADD COLUMN IF NOT EXISTS serial_number TEXT`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES warehouse_item_batches(id)`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS lot_number TEXT`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS expiry_date DATE`,
        `ALTER TABLE public.warehouse_stock_movements ADD COLUMN IF NOT EXISTS serial_number TEXT`,
        `CREATE INDEX IF NOT EXISTS idx_wsl_warehouse_item ON public.warehouse_stock_levels(warehouse_id, stock_item_id)`,
        `CREATE INDEX IF NOT EXISTS idx_wsm_direction_created ON public.warehouse_stock_movements(direction, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_wsm_department ON public.warehouse_stock_movements(to_department_id)`,
        `CREATE INDEX IF NOT EXISTS idx_wsm_section ON public.warehouse_stock_movements(to_section_id)`,
        `CREATE INDEX IF NOT EXISTS idx_wsm_transfer ON public.warehouse_stock_movements(reference_transfer_id)`
        ,`CREATE INDEX IF NOT EXISTS idx_itxn_type_created ON public.inventory_transactions(transaction_type, created_at)`
        ,`CREATE INDEX IF NOT EXISTS idx_itxn_item_batch ON public.inventory_transactions(stock_item_id, batch_id)`
        ,`CREATE INDEX IF NOT EXISTS idx_itxn_request ON public.inventory_transactions(reference_request_id)`
        ,`CREATE INDEX IF NOT EXISTS idx_itxn_transfer ON public.inventory_transactions(reference_transfer_id)`
      ];

      for (const statement of statements) {
        await runner.query(statement);
      }

      tablesEnsured = true;
    })().catch((error) => {
      tablesEnsuredPromise = null;
      throw error;
    });
  }

  await tablesEnsuredPromise;
};

module.exports = ensureWarehouseInventoryTables;