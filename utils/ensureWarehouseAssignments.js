const pool = require('../config/db');

let columnsEnsured = false;

/**
 * Ensure dedicated warehouse storage exists alongside the linking columns
 * used across the app (user warehouse assignment and request fulfillment
 * warehouse).
 */
const ensureWarehouseAssignments = async (client = pool) => {
  if (columnsEnsured || process.env.NODE_ENV === 'test') {
    columnsEnsured = true;
    return;
  }

  const runner = client.query ? client : pool;

  await runner.query(`
    CREATE TABLE IF NOT EXISTS public.warehouses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'warehouse',
      location TEXT,
      description TEXT,
      department_id INTEGER UNIQUE REFERENCES departments(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await runner.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_lower_name ON public.warehouses (LOWER(name))`
  );

  // Ensure link columns exist before rewiring foreign keys
  await runner.query(
    `ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS warehouse_id INTEGER`
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS supply_warehouse_id INTEGER`
  );

  // Seed warehouse records for any legacy department-based assignments
  await runner.query(`
    INSERT INTO public.warehouses (name, department_id, description)
    SELECT d.name, d.id, 'Migrated from departments table'
      FROM public.departments d
     WHERE d.id IN (
       SELECT warehouse_id FROM public.users WHERE warehouse_id IS NOT NULL
       UNION
       SELECT supply_warehouse_id FROM public.requests WHERE supply_warehouse_id IS NOT NULL
     )
    ON CONFLICT (department_id) DO NOTHING;
  `);

  // Repoint assignments to warehouse IDs using the migrated mapping
  await runner.query(`
    UPDATE public.users u
       SET warehouse_id = w.id
      FROM public.warehouses w
     WHERE u.warehouse_id = w.department_id;
  `);

  await runner.query(`
    UPDATE public.requests r
       SET supply_warehouse_id = w.id
      FROM public.warehouses w
     WHERE r.supply_warehouse_id = w.department_id;
  `);

  // Refresh foreign keys to point at the warehouses table
  await runner.query(
    `ALTER TABLE IF EXISTS public.users DROP CONSTRAINT IF EXISTS users_warehouse_id_fkey`
  );
  await runner.query(
    `ALTER TABLE IF EXISTS public.requests DROP CONSTRAINT IF EXISTS requests_supply_warehouse_id_fkey`
  );

  await runner.query(
    `ALTER TABLE IF EXISTS public.users
       ADD CONSTRAINT users_warehouse_id_fkey
       FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL`
  );

  await runner.query(
    `ALTER TABLE IF EXISTS public.requests
       ADD CONSTRAINT requests_supply_warehouse_id_fkey
       FOREIGN KEY (supply_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL`
  );

  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON public.users(warehouse_id)`
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_requests_supply_warehouse ON public.requests(supply_warehouse_id)`
  );

  columnsEnsured = true;
};

module.exports = ensureWarehouseAssignments;