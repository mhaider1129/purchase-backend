-- Warehouses table and foreign key updates
-- Run this script in Supabase to provision a dedicated warehouses table
-- and rewire existing warehouse assignments away from departments.

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'warehouse',
  location TEXT,
  description TEXT,
  department_id INTEGER UNIQUE REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_lower_name ON public.warehouses (LOWER(name));

-- Ensure linking columns exist before applying fresh constraints
ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS warehouse_id INTEGER;
ALTER TABLE IF EXISTS public.requests ADD COLUMN IF NOT EXISTS supply_warehouse_id INTEGER;

-- Seed warehouse records for any legacy department-based assignments
INSERT INTO public.warehouses (name, department_id, description)
SELECT d.name, d.id, 'Migrated from departments table'
  FROM public.departments d
 WHERE d.id IN (
   SELECT warehouse_id FROM public.users WHERE warehouse_id IS NOT NULL
   UNION
   SELECT supply_warehouse_id FROM public.requests WHERE supply_warehouse_id IS NOT NULL
 )
ON CONFLICT (department_id) DO NOTHING;

-- Repoint assignments to warehouse IDs using the migrated mapping
UPDATE public.users u
   SET warehouse_id = w.id
  FROM public.warehouses w
 WHERE u.warehouse_id = w.department_id;

UPDATE public.requests r
   SET supply_warehouse_id = w.id
  FROM public.warehouses w
 WHERE r.supply_warehouse_id = w.department_id;

-- Refresh foreign keys to target warehouses
ALTER TABLE IF EXISTS public.users DROP CONSTRAINT IF EXISTS users_warehouse_id_fkey;
ALTER TABLE IF EXISTS public.requests DROP CONSTRAINT IF EXISTS requests_supply_warehouse_id_fkey;

ALTER TABLE IF EXISTS public.users
  ADD CONSTRAINT users_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.requests
  ADD CONSTRAINT requests_supply_warehouse_id_fkey
  FOREIGN KEY (supply_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON public.users(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_requests_supply_warehouse ON public.requests(supply_warehouse_id);

COMMIT;