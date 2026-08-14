-- MANUAL ONLY. Phase 5A.1 additive reference-master baseline.
-- This file is not wired to application startup and must be reviewed before use.
BEGIN;

-- Preflight: inspect ownership and current columns before applying.
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE c.oid IN ('public.item_categories'::regclass,'public.item_manufacturers'::regclass,'public.item_uom'::regclass)
ORDER BY c.relname,a.attnum;

ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
UPDATE item_categories SET normalized_name=LOWER(REGEXP_REPLACE(TRIM(category_name),'\s+',' ','g')) WHERE normalized_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS item_categories_normalized_name_idx ON item_categories(normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS item_uom_normalized_uom_code_idx ON item_uom(normalized_uom_code);

-- Post-validation: duplicate result sets must be empty.
SELECT normalized_name,COUNT(*) FROM item_categories GROUP BY normalized_name HAVING COUNT(*)>1;
SELECT normalized_name,COUNT(*) FROM item_manufacturers GROUP BY normalized_name HAVING COUNT(*)>1;
SELECT normalized_uom_code,COUNT(*) FROM item_uom GROUP BY normalized_uom_code HAVING COUNT(*)>1;
COMMIT;