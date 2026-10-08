-- MANUAL DATABASE MIGRATION REQUIRED (reference data only).
-- Run the entire file in Supabase SQL Editor, then Refresh reference lists.
-- Equivalent starter identities to the application's Set up standard lists.
-- Existing rows, including inactive matches, are never updated/reactivated.
-- No manufacturers, packaging conversions, permission grants or items are inferred.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.item_categories') IS NULL
     OR to_regclass('public.item_uom') IS NULL
     OR to_regclass('public.item_master_audit_events') IS NULL THEN
    RAISE EXCEPTION 'Item Master foundation tables are missing. Review schema reconciliation SQL 035 before running this data-only patch.';
  END IF;
END $$;

-- Serialize reference writes while checking legacy unnormalized identities.
LOCK TABLE public.item_categories, public.item_uom IN SHARE ROW EXCLUSIVE MODE;

WITH starter(category_name) AS (
  VALUES ('General Items'), ('Medications'), ('Medical Supplies'),
    ('Medical Devices'), ('Laboratory Items'), ('Maintenance Spare Parts'),
    ('IT Items'), ('Stationery'), ('Furniture'), ('Equipment'),
    ('General Consumables'), ('Cleaning Supplies'), ('Linen'),
    ('Food and Beverages'), ('Services')
), inserted AS (
  INSERT INTO public.item_categories (category_name, normalized_name, is_active)
  SELECT s.category_name, lower(s.category_name), TRUE
  FROM starter s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.item_categories c
    WHERE c.normalized_name = lower(s.category_name)
      OR lower(regexp_replace(btrim(c.category_name), '\s+', ' ', 'g')) = lower(s.category_name)
  )
  ON CONFLICT DO NOTHING
  RETURNING *
)
INSERT INTO public.item_master_audit_events
  (entity_type, entity_id, action, actor_id, reason, new_values)
SELECT 'item_categories', i.id, 'REFERENCE_CREATED', NULL,
  'Manual SQL 044 starter data; database role: ' || current_user, to_jsonb(i)
FROM inserted i;

WITH starter(uom_code, uom_name) AS (
  VALUES ('EA', 'Each'), ('BOX', 'Box'), ('PACK', 'Pack'),
    ('SET', 'Set'), ('PAIR', 'Pair'), ('M', 'Metre'),
    ('KG', 'Kilogram'), ('G', 'Gram'), ('L', 'Litre'),
    ('ML', 'Millilitre'), ('HOUR', 'Hour'), ('DAY', 'Day')
), inserted AS (
  INSERT INTO public.item_uom
    (uom_code, uom_name, normalized_uom_code, is_active, is_base_uom)
  SELECT s.uom_code, s.uom_name, s.uom_code, TRUE, FALSE
  FROM starter s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.item_uom u
    WHERE u.normalized_uom_code = s.uom_code
      OR upper(regexp_replace(btrim(u.uom_code), '[^A-Za-z0-9]', '', 'g')) = s.uom_code
      OR lower(btrim(u.uom_name)) = lower(s.uom_name)
  )
  ON CONFLICT DO NOTHING
  RETURNING *
)
INSERT INTO public.item_master_audit_events
  (entity_type, entity_id, action, actor_id, reason, new_values)
SELECT 'item_uom', i.id, 'REFERENCE_CREATED', NULL,
  'Manual SQL 044 starter data; database role: ' || current_user, to_jsonb(i)
FROM inserted i;

COMMIT;

-- Counts include your existing records. Inactive matches stay inactive.
SELECT 'categories' AS reference_list,
  count(*) FILTER (WHERE is_active) AS active_count,
  count(*) FILTER (WHERE NOT is_active) AS inactive_count
FROM public.item_categories
UNION ALL
SELECT 'uom', count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE NOT is_active)
FROM public.item_uom;
