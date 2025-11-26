const pool = require('../config/db');

let tablesEnsured = false;
let approvalColumnsEnsured = false;

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

const ensureWarehouseSupplyApprovalColumns = async (client = pool) => {
  if (approvalColumnsEnsured) return;

  await ensureWarehouseSupplyTables(client);

  const runner = client.query ? client : pool;

  const statements = [
    `ALTER TABLE public.warehouse_supply_items ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'Pending'`,
    `ALTER TABLE public.warehouse_supply_items ALTER COLUMN approval_status SET DEFAULT 'Pending'`,
    `UPDATE public.warehouse_supply_items SET approval_status = 'Pending' WHERE approval_status IS NULL`,
    `ALTER TABLE public.warehouse_supply_items ADD COLUMN IF NOT EXISTS approval_comments TEXT`,
    `ALTER TABLE public.warehouse_supply_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
    `ALTER TABLE public.warehouse_supply_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  await runner.query(`
    DO $$
    DECLARE
      column_info RECORD;
      normalized_type TEXT;
    BEGIN
      SELECT
        CASE
          WHEN data_type = 'USER-DEFINED' THEN udt_name
          ELSE data_type
        END AS resolved_type
      INTO column_info
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'warehouse_supply_items'
        AND column_name = 'approved_by';

      normalized_type := column_info.resolved_type;

      IF column_info IS NULL THEN
        ALTER TABLE public.warehouse_supply_items ADD COLUMN approved_by INTEGER;
      ELSIF normalized_type NOT IN ('integer', 'int4', 'uuid', 'text', 'varchar', 'character varying') THEN
        ALTER TABLE public.warehouse_supply_items
          ALTER COLUMN approved_by DROP DEFAULT;
        ALTER TABLE public.warehouse_supply_items
          ALTER COLUMN approved_by TYPE INTEGER USING NULL::INTEGER;
      END IF;
    END
    $$;
  `);

  approvalColumnsEnsured = true;
};

module.exports = { ensureWarehouseSupplyTables, ensureWarehouseSupplyApprovalColumns };