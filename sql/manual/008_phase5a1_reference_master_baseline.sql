-- MANUAL ONLY. Phase 5A.1 additive reference-master baseline. DO NOT run automatically.
BEGIN;

-- Explicit prerequisites avoid raw regclass resolution errors on uncertain baselines.
DO $prerequisites$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY['item_categories','item_manufacturers','item_uom'] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'REQUIRED_CANONICAL_TABLE_MISSING: public.%', required_table;
    END IF;
  END LOOP;
END $prerequisites$;

SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE c.oid = ANY (ARRAY[to_regclass('public.item_categories'),to_regclass('public.item_manufacturers'),to_regclass('public.item_uom')])
ORDER BY c.relname,a.attnum;

ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
-- Manufacturer lifecycle/actor fields are supplied by the deployed foundation migration.
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS normalized_uom_code TEXT;
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE item_uom ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);

UPDATE item_categories SET normalized_name=LOWER(REGEXP_REPLACE(TRIM(category_name),'\s+',' ','g')) WHERE normalized_name IS NULL;
UPDATE item_uom SET normalized_uom_code=UPPER(REGEXP_REPLACE(TRIM(uom_code),'[^A-Za-z0-9]','','g')) WHERE normalized_uom_code IS NULL;

-- Data-quality preflight: abort descriptively before any unique index is attempted.
DO $duplicates$
DECLARE category_duplicates integer; manufacturer_duplicates integer; uom_code_duplicates integer; uom_name_duplicates integer;
BEGIN
 SELECT COUNT(*) INTO category_duplicates FROM (SELECT normalized_name FROM item_categories GROUP BY normalized_name HAVING COUNT(*)>1) d;
 SELECT COUNT(*) INTO manufacturer_duplicates FROM (SELECT normalized_name FROM item_manufacturers GROUP BY normalized_name HAVING COUNT(*)>1) d;
 SELECT COUNT(*) INTO uom_code_duplicates FROM (SELECT normalized_uom_code FROM item_uom GROUP BY normalized_uom_code HAVING COUNT(*)>1) d;
 SELECT COUNT(*) INTO uom_name_duplicates FROM (SELECT uom_name FROM item_uom GROUP BY uom_name HAVING COUNT(*)>1) d;
 IF category_duplicates+manufacturer_duplicates+uom_code_duplicates+uom_name_duplicates > 0 THEN
   RAISE EXCEPTION 'REFERENCE_NORMALIZATION_DUPLICATES: categories=%, manufacturers=%, uom_codes=%, uom_names=%; resolve manually (no rows were merged)', category_duplicates,manufacturer_duplicates,uom_code_duplicates,uom_name_duplicates;
 END IF;
END $duplicates$;

CREATE UNIQUE INDEX IF NOT EXISTS item_categories_normalized_name_idx ON item_categories(normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS item_uom_normalized_uom_code_idx ON item_uom(normalized_uom_code);
COMMIT;
