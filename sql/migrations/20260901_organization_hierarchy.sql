BEGIN;

CREATE TABLE IF NOT EXISTS organization_units (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER REFERENCES institutes(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  unit_type VARCHAR(30) NOT NULL CHECK (unit_type IN ('INSTITUTE','EXECUTIVE_OFFICE','DIRECTORATE','DEPARTMENT','SECTION','UNIT')),
  parent_unit_id BIGINT REFERENCES organization_units(id),
  department_id INTEGER UNIQUE REFERENCES departments(id),
  section_id INTEGER UNIQUE REFERENCES sections(id),
  classification VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id), updated_by INTEGER REFERENCES users(id),
  CONSTRAINT organization_units_not_self_parent CHECK (parent_unit_id IS NULL OR parent_unit_id <> id),
  CONSTRAINT organization_units_one_legacy_link CHECK (department_id IS NULL OR section_id IS NULL)
);
CREATE INDEX IF NOT EXISTS organization_units_parent_idx ON organization_units(parent_unit_id);
CREATE INDEX IF NOT EXISTS organization_units_institute_idx ON organization_units(institute_id);
CREATE INDEX IF NOT EXISTS organization_units_type_active_idx ON organization_units(unit_type,is_active);

CREATE TABLE IF NOT EXISTS organization_positions (
  id BIGSERIAL PRIMARY KEY,
  organization_unit_id BIGINT NOT NULL REFERENCES organization_units(id),
  position_type VARCHAR(30) NOT NULL CHECK (position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD','CUSTOM')),
  position_name VARCHAR(255) NOT NULL,
  user_id INTEGER REFERENCES users(id), is_unit_head BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, effective_from DATE, effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id), updated_by INTEGER REFERENCES users(id),
  CONSTRAINT organization_positions_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS organization_positions_unit_idx ON organization_positions(organization_unit_id,is_active);
CREATE INDEX IF NOT EXISTS organization_positions_user_idx ON organization_positions(user_id);

CREATE OR REPLACE FUNCTION reject_organization_unit_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_unit_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_unit_id = NEW.id OR EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT id FROM organization_units WHERE parent_unit_id = NEW.id
      UNION ALL SELECT u.id FROM organization_units u JOIN descendants d ON u.parent_unit_id=d.id
    ) SELECT 1 FROM descendants WHERE id=NEW.parent_unit_id
  ) THEN RAISE EXCEPTION 'organization hierarchy cycle detected' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organization_units_cycle_guard ON organization_units;
CREATE TRIGGER organization_units_cycle_guard BEFORE INSERT OR UPDATE OF parent_unit_id ON organization_units
FOR EACH ROW EXECUTE FUNCTION reject_organization_unit_cycle();

INSERT INTO organization_units(institute_id,name,unit_type,department_id,classification)
SELECT d.institute_id,d.name,'DEPARTMENT',d.id,d.type FROM departments d
ON CONFLICT (department_id) DO NOTHING;
INSERT INTO organization_units(institute_id,name,unit_type,parent_unit_id,section_id,classification)
SELECT d.institute_id,s.name,'SECTION',ou.id,s.id,d.type FROM sections s JOIN departments d ON d.id=s.department_id
JOIN organization_units ou ON ou.department_id=d.id ON CONFLICT (section_id) DO NOTHING;
COMMIT;