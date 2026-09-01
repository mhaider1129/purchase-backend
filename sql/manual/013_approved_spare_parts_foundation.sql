-- PENDING MANUAL MIGRATION 013. Generate/review only; never run automatically.
BEGIN;

DO $preflight$
DECLARE required_table text; present_count integer;
BEGIN
  FOREACH required_table IN ARRAY ARRAY['institutes','departments','users','permissions','generic_items','approved_products','audit_logs'] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'SQL_013_REQUIRED_TABLE_MISSING: public.%', required_table;
    END IF;
  END LOOP;
  SELECT count(*) INTO present_count FROM (VALUES
    ('approved_spare_parts'),('maintainable_equipment'),('spare_part_equipment_compatibility')
  ) AS expected(name) WHERE to_regclass('public.' || name) IS NOT NULL;
  IF present_count <> 0 THEN
    RAISE EXCEPTION 'SQL_013_ALREADY_OR_PARTIALLY_INSTALLED: expected zero foundation tables, found %; reconcile before applying', present_count;
  END IF;
END $preflight$;

-- No canonical equipment/asset register exists at HEAD; this is deliberately identity-only.
CREATE TABLE maintainable_equipment (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
  equipment_code TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX maintainable_equipment_institute_code_uq ON maintainable_equipment(institute_id, lower(btrim(equipment_code)));
-- Supports the institute-scoped equipment register's ORDER BY name.
CREATE INDEX maintainable_equipment_institute_name_idx ON maintainable_equipment(institute_id, name);
-- Supports institute-scoped department and lifecycle filtering/reporting.
CREATE INDEX maintainable_equipment_institute_department_lifecycle_idx ON maintainable_equipment(institute_id, department_id, lifecycle_status);

CREATE TABLE approved_spare_parts (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
  spare_part_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  generic_item_id BIGINT REFERENCES generic_items(id) ON DELETE RESTRICT,
  preferred_approved_product_id BIGINT REFERENCES approved_products(id) ON DELETE RESTRICT,
  manufacturer_name TEXT, oem_part_number TEXT, manufacturer_part_number TEXT,
  drawing_number TEXT, revision TEXT, technical_specification TEXT,
  spare_part_type TEXT NOT NULL CHECK (spare_part_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  criticality TEXT NOT NULL CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  failure_consequence TEXT NOT NULL CHECK (failure_consequence IN ('PATIENT_SAFETY','EQUIPMENT_SHUTDOWN','SERVICE_DEGRADATION','MAINTENANCE_EFFICIENCY','NON_CRITICAL')),
  interchangeability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (interchangeability_status IN ('EXACT','INTERCHANGEABLE','CONDITIONAL','NOT_INTERCHANGEABLE','UNKNOWN')),
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE','INACTIVE','OBSOLETE','SUPERSEDED')),
  is_repairable BOOLEAN NOT NULL DEFAULT false, is_serialized BOOLEAN NOT NULL DEFAULT false,
  is_consumable BOOLEAN NOT NULL DEFAULT true, is_safety_critical BOOLEAN NOT NULL DEFAULT false,
  recommended_stocking_policy TEXT NOT NULL DEFAULT 'ORDER_ON_DEMAND' CHECK (recommended_stocking_policy IN ('DO_NOT_STOCK','NORMAL_STOCK','SAFETY_STOCK','STRATEGIC_STOCK','ORDER_ON_DEMAND')),
  recommended_min_quantity NUMERIC, recommended_max_quantity NUMERIC, recommended_safety_stock NUMERIC,
  typical_lead_time_days INTEGER, estimated_annual_consumption NUMERIC,
  shelf_life_days INTEGER, storage_conditions TEXT,
  technical_approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (technical_approval_status IN ('DRAFT','UNDER_REVIEW','APPROVED','CONDITIONALLY_APPROVED','REJECTED')),
  technical_approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  technical_approved_at TIMESTAMPTZ, technical_approval_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CONSTRAINT approved_spare_parts_quantities_nonnegative CHECK (
    (recommended_min_quantity IS NULL OR recommended_min_quantity >= 0) AND
    (recommended_max_quantity IS NULL OR recommended_max_quantity >= 0) AND
    (recommended_safety_stock IS NULL OR recommended_safety_stock >= 0) AND
    (estimated_annual_consumption IS NULL OR estimated_annual_consumption >= 0) AND
    (typical_lead_time_days IS NULL OR typical_lead_time_days >= 0) AND
    (shelf_life_days IS NULL OR shelf_life_days >= 0) AND
    (recommended_min_quantity IS NULL OR recommended_max_quantity IS NULL OR recommended_max_quantity >= recommended_min_quantity)),
  CONSTRAINT approved_spare_parts_approval_evidence CHECK (
    (technical_approval_status IN ('DRAFT','UNDER_REVIEW') AND technical_approved_by IS NULL AND technical_approved_at IS NULL)
    OR (technical_approval_status IN ('APPROVED','CONDITIONALLY_APPROVED','REJECTED') AND technical_approved_by IS NOT NULL AND technical_approved_at IS NOT NULL)),
  CONSTRAINT approved_spare_parts_reason_required CHECK (
    technical_approval_status NOT IN ('CONDITIONALLY_APPROVED','REJECTED') OR nullif(btrim(technical_approval_reason),'') IS NOT NULL)
);
CREATE UNIQUE INDEX approved_spare_parts_institute_code_uq ON approved_spare_parts(institute_id, lower(btrim(spare_part_code)));
CREATE INDEX approved_spare_parts_filters_idx ON approved_spare_parts(institute_id,lifecycle_status,technical_approval_status,criticality);
-- Supports the default institute-scoped register ordering and stable id tie-break.
CREATE INDEX approved_spare_parts_institute_updated_idx ON approved_spare_parts(institute_id, updated_at DESC, id DESC);
-- Supports the dedicated stocking-policy filter within an institute.
CREATE INDEX approved_spare_parts_institute_stocking_idx ON approved_spare_parts(institute_id, recommended_stocking_policy);
-- Leading-wildcard ILIKE search intentionally has no B-tree index; a governed
-- search/trigram strategy is deferred until production query volume warrants it.

CREATE TABLE spare_part_equipment_compatibility (
  id BIGSERIAL PRIMARY KEY,
  spare_part_id BIGINT NOT NULL REFERENCES approved_spare_parts(id) ON DELETE RESTRICT,
  equipment_id BIGINT NOT NULL REFERENCES maintainable_equipment(id) ON DELETE RESTRICT,
  compatibility_type TEXT NOT NULL CHECK (compatibility_type IN ('OEM_SPECIFIED','OEM_CONFIRMED','TECHNICALLY_VERIFIED','APPROVED_EQUIVALENT','CONDITIONAL')),
  compatibility_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (compatibility_status IN ('PENDING','APPROVED','REJECTED','INACTIVE')),
  serial_number_from TEXT, serial_number_to TEXT, oem_confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmation_reference TEXT, technical_notes TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT, approved_at TIMESTAMPTZ,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compatibility_approval_evidence CHECK (compatibility_status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX spare_part_equipment_active_uq ON spare_part_equipment_compatibility(spare_part_id,equipment_id) WHERE compatibility_status IN ('PENDING','APPROVED');
-- Supports reverse equipment filtering from the Spare Parts register while
-- excluding inactive relationships, matching the authoritative EXISTS query.
CREATE INDEX spare_part_equipment_equipment_active_idx ON spare_part_equipment_compatibility(equipment_id, spare_part_id) WHERE compatibility_status <> 'INACTIVE';

INSERT INTO permissions(code,name,description) VALUES
 ('spare-parts.view','View approved spare parts','View institute-scoped spare parts and compatibility'),
 ('spare-parts.create','Create approved spare parts','Create draft technical spare-part identities'),
 ('spare-parts.edit','Edit approved spare parts','Edit technical spare-part identities'),
 ('spare-parts.technical-approve','Technically approve spare parts','Submit and decide technical approvals'),
 ('spare-parts.manage-compatibility','Manage spare-part compatibility','Create, edit and decide equipment compatibility'),
 ('spare-parts.manage-stock-policy','Manage spare-part stock policy','Change recommended stocking policy and quantities'),
 ('spare-parts.archive','Archive approved spare parts','Inactivate spare-part identities')
ON CONFLICT (code) DO NOTHING;
COMMIT;