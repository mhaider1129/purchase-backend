-- Schema for approval routing rules stored in Supabase/PostgreSQL
-- Run this script inside the database referenced by DATABASE_URL.

CREATE TABLE IF NOT EXISTS public.approval_routes (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(50) NOT NULL,
  department_type VARCHAR(50) NOT NULL,
  approval_level INTEGER NOT NULL,
  role VARCHAR(50) NOT NULL,
  min_amount BIGINT DEFAULT 0,
  max_amount BIGINT DEFAULT 999999999
);

CREATE INDEX IF NOT EXISTS approval_routes_lookup_idx
  ON public.approval_routes (request_type, department_type, approval_level);

-- Example seed rows (safe to remove/update per your organization's policy)
-- Canonical routing configuration exported from Supabase (2024-12)
INSERT INTO public.approval_routes
  (id, request_type, department_type, approval_level, role, min_amount, max_amount)
VALUES
  (1, 'Stock', 'medical', 1, 'HOD', 0, 5000000),
  (2, 'Stock', 'medical', 2, 'CMO', 0, 5000000),
  (3, 'Stock', 'medical', 3, 'SCM', 0, 5000000),
  (4, 'Stock', 'medical', 4, 'CFO', 10000001, 999999999),
  (5, 'Non-Stock', 'operational', 1, 'HOD', 0, 10000000),
  (6, 'Non-Stock', 'operational', 2, 'WarehouseManager', 0, 10000000),
  (7, 'Non-Stock', 'operational', 3, 'SCM', 0, 10000000),
  (8, 'Non-Stock', 'operational', 5, 'COO', 0, 10000000),
  (9, 'Medical Device', 'medical', 1, 'HOD', 0, 999999999),
  (10, 'Medical Device', 'medical', 3, 'Medical Devices', 0, 999999999),
  (11, 'Medical Device', 'medical', 2, 'CMO', 0, 999999999),
  (12, 'Medical Device', 'medical', 4, 'SCM', 0, 999999999),
  (13, 'Medical Device', 'medical', 5, 'COO', 0, 999999999),
  (14, 'Stock', 'operational', 1, 'HOD', 0, 999999999),
  (15, 'Stock', 'operational', 2, 'SCM', 0, 999999999),
  (16, 'Stock', 'operational', 4, 'COO', 0, 999999999),
  (17, 'Non-Stock', 'medical', 1, 'HOD', 0, 99999999),
  (18, 'Non-Stock', 'medical', 2, 'WarehouseManager', 0, 999999999),
  (19, 'Non-Stock', 'medical', 3, 'CMO', 0, 999999999),
  (20, 'Non-Stock', 'medical', 4, 'SCM', 0, 999999999),
  (22, 'Non-Stock', 'medical', 6, 'COO', 0, 999999999),
  (33, 'Maintenance', 'medical', 2, 'HOD', 0, 999999999),
  (34, 'Maintenance', 'medical', 1, 'WarehouseManager', 0, 999999999),
  (35, 'Maintenance', 'medical', 3, 'CMO', 0, 999999999),
  (36, 'Maintenance', 'medical', 4, 'SCM', 0, 999999999),
  (37, 'Maintenance', 'medical', 5, 'COO', 0, 999999999),
  (38, 'Maintenance', 'operational', 1, 'requester', 0, 999999999),
  (39, 'Maintenance', 'operational', 2, 'HOD', 0, 999999999),
  (40, 'Maintenance', 'operational', 3, 'WarehouseManager', 0, 999999999),
  (41, 'Maintenance', 'operational', 4, 'SCM', 0, 999999999),
  (42, 'Maintenance', 'operational', 5, 'COO', 0, 999999999),
  (43, 'IT Item', 'medical', 1, 'HOD', 0, 999999999),
  (44, 'IT Item', 'medical', 2, 'SCM', 0, 999999999),
  (45, 'IT Item', 'medical', 4, 'COO', 0, 999999999),
  (46, 'IT Item', 'operational', 1, 'HOD', 0, 999999999),
  (47, 'IT Item', 'operational', 2, 'SCM', 0, 999999999),
  (48, 'IT Item', 'operational', 4, 'COO', 0, 999999999),
  (49, 'Warehouse Supply', 'medical', 1, 'HOD', 0, 999999999),
  (50, 'Warehouse Supply', 'medical', 2, 'WarehouseManager', 0, 999999999),
  (51, 'Warehouse Supply', 'operational', 1, 'HOD', 0, 999999999),
  (52, 'Warehouse Supply', 'operational', 2, 'WarehouseManager', 0, 999999999),
  (54, 'Non-Stock', 'medical', 5, 'CFO', 5000001, 999999999),
  (55, 'IT Item', 'medical', 3, 'CFO', 5000001, 999999999),
  (56, 'IT Item', 'operational', 3, 'CFO', 5000001, 999999999),
  (57, 'Non-Stock', 'operational', 4, 'CFO', 5000001, 999999999),
  (58, 'Stock', 'operational', 3, 'CFO', 5000001, 999999999)
ON CONFLICT (id) DO UPDATE
  SET request_type = EXCLUDED.request_type,
      department_type = EXCLUDED.department_type,
      approval_level = EXCLUDED.approval_level,
      role = EXCLUDED.role,
      min_amount = EXCLUDED.min_amount,
      max_amount = EXCLUDED.max_amount;