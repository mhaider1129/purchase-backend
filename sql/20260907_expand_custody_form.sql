BEGIN;

ALTER TABLE custody_records
  DROP CONSTRAINT IF EXISTS custody_records_custody_type_check;

ALTER TABLE custody_records
  ADD CONSTRAINT custody_records_custody_type_check
    CHECK (custody_type IN ('Personal', 'Departmental', 'Location')),
  ADD COLUMN IF NOT EXISTS asset_category text,
  ADD COLUMN IF NOT EXISTS asset_tag text,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS condition_at_issue text,
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS room text,
  ADD COLUMN IF NOT EXISTS section_unit text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS pre_existing_condition text,
  ADD COLUMN IF NOT EXISTS acknowledgment_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledgment_accepted_at timestamp without time zone;

ALTER TABLE custody_records
  DROP CONSTRAINT IF EXISTS custody_records_condition_at_issue_check;

ALTER TABLE custody_records
  ADD CONSTRAINT custody_records_condition_at_issue_check
    CHECK (condition_at_issue IS NULL OR condition_at_issue IN
      ('New', 'Excellent', 'Good', 'Fair', 'Damaged / Defective'));

COMMIT;