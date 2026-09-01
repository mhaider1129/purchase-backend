-- 014: Organization hierarchy foundation (additive; not an approval workflow).
BEGIN;

-- Fail-closed preflight. A compatible installation is a successful no-op; the
-- convergent statements below can safely run again without duplicating data.
DO $$
DECLARE
  units_exists boolean := to_regclass('public.organization_units') IS NOT NULL;
  positions_exists boolean := to_regclass('public.organization_positions') IS NOT NULL;
  missing_contract text;
BEGIN
  IF NOT units_exists AND NOT positions_exists THEN
    IF to_regprocedure('public.validate_organization_unit()') IS NOT NULL
       OR to_regprocedure('public.validate_organization_position_user()') IS NOT NULL THEN
      RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
    END IF;
    RETURN;
  END IF;
  IF NOT units_exists OR NOT positions_exists THEN
    RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
    INTO missing_contract
    FROM (VALUES
      ('organization_units','id'),('organization_units','institute_id'),('organization_units','unit_type'),
      ('organization_units','parent_unit_id'),('organization_units','department_id'),('organization_units','section_id'),
      ('organization_units','classification'),('organization_units','sort_order'),('organization_units','is_active'),
      ('organization_positions','id'),('organization_positions','organization_unit_id'),
      ('organization_positions','position_type'),('organization_positions','user_id'),
      ('organization_positions','is_unit_head'),('organization_positions','effective_from'),
      ('organization_positions','effective_to'),('organization_positions','is_active')
    ) expected(table_name,column_name)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name);
  IF missing_contract IS NOT NULL
     OR to_regclass('public.organization_units_parent_idx') IS NULL
     OR to_regclass('public.organization_units_institute_code_uq') IS NULL
     OR to_regclass('public.organization_positions_unique_authority_uq') IS NULL
     OR to_regclass('public.organization_positions_unit_head_uq') IS NULL
     OR to_regprocedure('public.validate_organization_unit()') IS NULL
     OR to_regprocedure('public.validate_organization_position_user()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='organization_units_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='organization_positions_institute_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SQL_014_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;
  -- Do not raise for this state. Supabase reports user-raised P0001 exceptions
  -- as failed queries even though there is no migration work left to perform.
  RAISE NOTICE 'SQL_014_ALREADY_APPLIED_COMPATIBLE';
  RETURN;
END $$;

-- This migration may be applied after the superseded dated draft was tested in a
-- non-production database.  Keep the forward migration convergent so that those
-- databases can adopt the governed lineage without dropping hierarchy data.
CREATE TABLE IF NOT EXISTS organization_units (
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
ALTER TABLE organization_units ALTER COLUMN institute_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE organization_units ADD CONSTRAINT organization_units_legacy_identity CHECK (
    (department_id IS NULL OR (unit_type = 'DEPARTMENT' AND section_id IS NULL)) AND
    (section_id IS NULL OR (unit_type = 'SECTION' AND department_id IS NULL))
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS organization_units_parent_idx ON organization_units(parent_unit_id);
CREATE INDEX IF NOT EXISTS organization_units_institute_idx ON organization_units(institute_id, is_active);
CREATE INDEX IF NOT EXISTS organization_units_type_active_idx ON organization_units(unit_type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS organization_units_institute_code_uq ON organization_units(institute_id, lower(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_positions (
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
CREATE INDEX IF NOT EXISTS organization_positions_unit_idx ON organization_positions(organization_unit_id, is_active);
CREATE INDEX IF NOT EXISTS organization_positions_user_idx ON organization_positions(user_id);
-- Policy A: unique authority is unambiguous even for future-dated active rows.
CREATE UNIQUE INDEX IF NOT EXISTS organization_positions_unique_authority_uq
  ON organization_positions(organization_unit_id, position_type)
  WHERE is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD');
CREATE UNIQUE INDEX IF NOT EXISTS organization_positions_unit_head_uq
  ON organization_positions(organization_unit_id) WHERE is_active AND is_unit_head;

CREATE OR REPLACE FUNCTION validate_organization_unit() RETURNS trigger LANGUAGE plpgsql AS $$
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
DROP TRIGGER IF EXISTS organization_units_guard ON organization_units;
-- Remove the equivalent guard name used only by the superseded dated draft.
DROP TRIGGER IF EXISTS organization_units_cycle_guard ON organization_units;
CREATE TRIGGER organization_units_guard BEFORE INSERT OR UPDATE OF parent_unit_id,institute_id,department_id,section_id ON organization_units FOR EACH ROW EXECUTE FUNCTION validate_organization_unit();
DROP FUNCTION IF EXISTS reject_organization_unit_cycle();

CREATE OR REPLACE FUNCTION validate_organization_position_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_institute INTEGER; user_institute INTEGER;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT institute_id INTO unit_institute FROM organization_units WHERE id=NEW.organization_unit_id;
  SELECT institute_id INTO user_institute FROM users WHERE id=NEW.user_id;
  IF user_institute IS DISTINCT FROM unit_institute THEN RAISE EXCEPTION 'position holder must belong to organization unit institute' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organization_positions_institute_guard ON organization_positions;
CREATE TRIGGER organization_positions_institute_guard BEFORE INSERT OR UPDATE OF organization_unit_id,user_id ON organization_positions FOR EACH ROW EXECUTE FUNCTION validate_organization_position_user();

-- Classification is copied as metadata only. Departments deliberately have no inferred parent.
INSERT INTO organization_units(institute_id,name,unit_type,department_id,classification)
SELECT d.institute_id,d.name,'DEPARTMENT',d.id,d.type FROM departments d
ON CONFLICT (department_id) DO NOTHING;
INSERT INTO organization_units(institute_id,name,unit_type,parent_unit_id,section_id,classification)
SELECT d.institute_id,s.name,'SECTION',ou.id,s.id,d.type FROM sections s JOIN departments d ON d.id=s.department_id JOIN organization_units ou ON ou.department_id=d.id
ON CONFLICT (section_id) DO NOTHING;
COMMIT;