-- 014: Organization hierarchy foundation (additive; not an approval workflow).
BEGIN;

-- Fail-closed preflight. A compatible installation is a successful no-op; only
-- an absent schema is authorized to enter the deterministic installation block.
DO $$
DECLARE
  units_exists boolean := to_regclass('public.organization_units') IS NOT NULL;
  positions_exists boolean := to_regclass('public.organization_positions') IS NOT NULL;
  missing_contract text;
BEGIN
  PERFORM set_config('purchase_tracker.sql_014_install', 'false', true);
  IF NOT units_exists AND NOT positions_exists THEN
    IF to_regprocedure('public.validate_organization_unit()') IS NOT NULL
       OR to_regprocedure('public.validate_organization_position_user()') IS NOT NULL
       OR to_regclass('public.organization_units_id_seq') IS NOT NULL
       OR to_regclass('public.organization_positions_id_seq') IS NOT NULL
       OR to_regclass('public.organization_units_parent_idx') IS NOT NULL
       OR to_regclass('public.organization_units_institute_code_uq') IS NOT NULL
       OR to_regclass('public.organization_positions_unique_authority_uq') IS NOT NULL
       OR to_regclass('public.organization_positions_unit_head_uq') IS NOT NULL THEN
      RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
    END IF;
    PERFORM set_config('purchase_tracker.sql_014_install', 'true', true);
    RETURN;
  END IF;
  IF NOT units_exists OR NOT positions_exists THEN
    RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
    INTO missing_contract
    FROM (VALUES
      ('organization_units','institute_id','integer','NO'),
      ('organization_units','parent_unit_id','bigint','YES'),
      ('organization_units','department_id','integer','YES'),
      ('organization_units','section_id','integer','YES'),
      ('organization_units','unit_type','character varying','NO'),
      ('organization_positions','organization_unit_id','bigint','NO'),
      ('organization_positions','position_type','character varying','NO'),
      ('organization_positions','user_id','integer','YES'),
      ('organization_positions','is_active','boolean','NO'),
      ('organization_positions','effective_from','date','YES'),
      ('organization_positions','effective_to','date','YES')
    ) expected(table_name,column_name,data_type,is_nullable)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=expected.table_name
       AND c.column_name=expected.column_name AND c.data_type=expected.data_type
       AND c.is_nullable=expected.is_nullable);
  IF missing_contract IS NOT NULL
     OR to_regclass('public.organization_units_parent_idx') IS NULL
     OR to_regclass('public.organization_units_institute_code_uq') IS NULL
     OR to_regclass('public.organization_positions_unique_authority_uq') IS NULL
     OR to_regclass('public.organization_positions_unit_head_uq') IS NULL
     OR to_regprocedure('public.validate_organization_unit()') IS NULL
     OR to_regprocedure('public.validate_organization_position_user()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='public.organization_units'::regclass
            AND conname='organization_units_legacy_identity' AND contype='c'
            AND pg_get_constraintdef(oid) LIKE '%department_id%unit_type%DEPARTMENT%section_id%unit_type%SECTION%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='public.organization_positions'::regclass
            AND conname='organization_positions_dates' AND contype='c'
            AND pg_get_constraintdef(oid) LIKE '%effective_to%effective_from%effective_to >= effective_from%')
     OR NOT EXISTS (SELECT 1 FROM pg_index
          WHERE indexrelid=to_regclass('public.organization_units_institute_code_uq') AND indisunique
            AND indnkeyatts=2 AND pg_get_indexdef(indexrelid,1,true)='institute_id'
            AND pg_get_indexdef(indexrelid,2,true) LIKE 'lower(%code%'
            AND pg_get_expr(indpred,indrelid) LIKE '%code IS NOT NULL%')
     OR NOT EXISTS (SELECT 1 FROM pg_index
          WHERE indexrelid=to_regclass('public.organization_positions_unique_authority_uq') AND indisunique
            AND indnkeyatts=2 AND pg_get_indexdef(indexrelid,1,true)='organization_unit_id'
            AND pg_get_indexdef(indexrelid,2,true)='position_type'
            AND pg_get_expr(indpred,indrelid) LIKE '%is_active%'
            AND pg_get_expr(indpred,indrelid) LIKE '%UNIT_HEAD%'
            AND pg_get_expr(indpred,indrelid) LIKE '%EXECUTIVE_HEAD%'
            AND pg_get_expr(indpred,indrelid) LIKE '%DEPARTMENT_HEAD%'
            AND pg_get_expr(indpred,indrelid) LIKE '%SECTION_HEAD%')
     OR NOT EXISTS (SELECT 1 FROM pg_index
          WHERE indexrelid=to_regclass('public.organization_positions_unit_head_uq') AND indisunique
            AND indnkeyatts=1 AND pg_get_indexdef(indexrelid,1,true)='organization_unit_id'
            AND pg_get_expr(indpred,indrelid) LIKE '%is_active%'
            AND pg_get_expr(indpred,indrelid) LIKE '%is_unit_head%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='organization_units_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='organization_positions_institute_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;
  RAISE NOTICE 'SQL_014_ALREADY_APPLIED_COMPATIBLE';
END $$;


DO $install$
BEGIN
  IF current_setting('purchase_tracker.sql_014_install') <> 'true' THEN
    RETURN;
  END IF;
  EXECUTE $ddl$
CREATE TABLE organization_units (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  unit_type VARCHAR(30) NOT NULL CHECK (unit_type IN ('INSTITUTE','EXECUTIVE_OFFICE','DIRECTORATE','DEPARTMENT','SECTION','UNIT')),
  parent_unit_id BIGINT REFERENCES organization_units(id) ON DELETE RESTRICT,
  department_id INTEGER UNIQUE REFERENCES departments(id) ON DELETE RESTRICT,
  section_id INTEGER UNIQUE REFERENCES sections(id) ON DELETE RESTRICT,
  classification VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  CONSTRAINT organization_units_not_self_parent CHECK (parent_unit_id IS NULL OR parent_unit_id <> id),
  CONSTRAINT organization_units_legacy_identity CHECK (
    (department_id IS NULL OR (unit_type = 'DEPARTMENT' AND section_id IS NULL)) AND
    (section_id IS NULL OR (unit_type = 'SECTION' AND department_id IS NULL))
  )
);
  $ddl$;
  EXECUTE $ddl$
CREATE INDEX organization_units_parent_idx ON organization_units(parent_unit_id);
  $ddl$;
  EXECUTE $ddl$
CREATE INDEX organization_units_institute_idx ON organization_units(institute_id, is_active);
  $ddl$;
  EXECUTE $ddl$
CREATE INDEX organization_units_type_active_idx ON organization_units(unit_type, is_active);
  $ddl$;
  EXECUTE $ddl$
CREATE UNIQUE INDEX organization_units_institute_code_uq ON organization_units(institute_id, lower(code)) WHERE code IS NOT NULL;
  $ddl$;
  EXECUTE $ddl$
CREATE TABLE organization_positions (
  id BIGSERIAL PRIMARY KEY,
  organization_unit_id BIGINT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  position_type VARCHAR(30) NOT NULL CHECK (position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD','CUSTOM')),
  position_name VARCHAR(255) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  is_unit_head BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  CONSTRAINT organization_positions_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
  $ddl$;
  EXECUTE $ddl$
CREATE INDEX organization_positions_unit_idx ON organization_positions(organization_unit_id, is_active);
  $ddl$;
  EXECUTE $ddl$
CREATE INDEX organization_positions_user_idx ON organization_positions(user_id);
  $ddl$;
  EXECUTE $ddl$
CREATE UNIQUE INDEX organization_positions_unique_authority_uq
  ON organization_positions(organization_unit_id, position_type)
  WHERE is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD');
  $ddl$;
  EXECUTE $ddl$
CREATE UNIQUE INDEX organization_positions_unit_head_uq
  ON organization_positions(organization_unit_id) WHERE is_active AND is_unit_head;
  $ddl$;
  EXECUTE $ddl$
CREATE FUNCTION validate_organization_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_institute INTEGER; linked_institute INTEGER;
BEGIN
  IF NEW.parent_unit_id IS NOT NULL THEN
    SELECT institute_id INTO parent_institute FROM organization_units WHERE id=NEW.parent_unit_id FOR KEY SHARE;
    IF parent_institute IS NULL THEN RAISE EXCEPTION 'parent organization unit not found' USING ERRCODE='23503'; END IF;
    IF parent_institute <> NEW.institute_id THEN RAISE EXCEPTION 'organization units cannot cross institute boundaries' USING ERRCODE='23514'; END IF;
    IF NEW.parent_unit_id=NEW.id OR EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM organization_units WHERE parent_unit_id=NEW.id
        UNION ALL SELECT u.id FROM organization_units u JOIN descendants d ON u.parent_unit_id=d.id
      ) SELECT 1 FROM descendants WHERE id=NEW.parent_unit_id
    ) THEN RAISE EXCEPTION 'organization hierarchy cycle detected' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT institute_id INTO linked_institute FROM departments WHERE id=NEW.department_id;
    IF linked_institute IS DISTINCT FROM NEW.institute_id THEN RAISE EXCEPTION 'department must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.section_id IS NOT NULL THEN
    SELECT d.institute_id INTO linked_institute FROM sections s JOIN departments d ON d.id=s.department_id WHERE s.id=NEW.section_id;
    IF linked_institute IS DISTINCT FROM NEW.institute_id THEN RAISE EXCEPTION 'section must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
  $ddl$;
  EXECUTE $ddl$
CREATE TRIGGER organization_units_guard BEFORE INSERT OR UPDATE OF parent_unit_id,institute_id,department_id,section_id ON organization_units FOR EACH ROW EXECUTE FUNCTION validate_organization_unit();
  $ddl$;
  EXECUTE $ddl$
CREATE FUNCTION validate_organization_position_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_institute INTEGER; user_institute INTEGER;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT institute_id INTO unit_institute FROM organization_units WHERE id=NEW.organization_unit_id;
  SELECT institute_id INTO user_institute FROM users WHERE id=NEW.user_id;
  IF user_institute IS DISTINCT FROM unit_institute THEN RAISE EXCEPTION 'position holder must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
  $ddl$;
  EXECUTE $ddl$
CREATE TRIGGER organization_positions_institute_guard BEFORE INSERT OR UPDATE OF organization_unit_id,user_id ON organization_positions FOR EACH ROW EXECUTE FUNCTION validate_organization_position_user();
  $ddl$;
  EXECUTE $ddl$
INSERT INTO organization_units(institute_id,name,unit_type,department_id,classification)
SELECT d.institute_id,d.name,'DEPARTMENT',d.id,d.type FROM departments d
ON CONFLICT (department_id) DO NOTHING;
  $ddl$;
  EXECUTE $ddl$
INSERT INTO organization_units(institute_id,name,unit_type,parent_unit_id,section_id,classification)
SELECT d.institute_id,s.name,'SECTION',ou.id,s.id,d.type FROM sections s JOIN departments d ON d.id=s.department_id JOIN organization_units ou ON ou.department_id=d.id
ON CONFLICT (section_id) DO NOTHING;
  $ddl$;
END $install$;

COMMIT;