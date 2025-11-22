const pool = require('../config/db');

let columnsEnsured = false;

/**
 * Ensure auxiliary columns exist to track which warehouse a user manages
 * and which warehouse a supply request is fulfilled from.
 *
 * Warehouses are represented by rows in the departments table. This helper
 * adds lightweight foreign-keyed columns instead of introducing a new table
 * to keep compatibility with the existing schema.
 */
const ensureWarehouseAssignments = async (client = pool) => {
  if (columnsEnsured || process.env.NODE_ENV === 'test') {
    columnsEnsured = true;
    return;
  }

  const runner = client.query ? client : pool;

  const statements = [
    `ALTER TABLE IF EXISTS public.users
       ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES departments(id)`,
    `ALTER TABLE IF EXISTS public.requests
       ADD COLUMN IF NOT EXISTS supply_warehouse_id INTEGER REFERENCES departments(id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON public.users(warehouse_id)`,
    `CREATE INDEX IF NOT EXISTS idx_requests_supply_warehouse ON public.requests(supply_warehouse_id)`
  ];

  for (const statement of statements) {
    await runner.query(statement);
  }

  columnsEnsured = true;
};

module.exports = ensureWarehouseAssignments;