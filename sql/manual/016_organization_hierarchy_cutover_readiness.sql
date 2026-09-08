-- 016: Organization hierarchy cutover readiness. MANUAL/PENDING; depends on deployed 014.
-- This file is intentionally not executed by the application.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX organization_positions_unique_authority_uq;
DROP INDEX organization_positions_unit_head_uq;

ALTER TABLE organization_positions
  ADD CONSTRAINT organization_positions_unique_authority_period
  EXCLUDE USING gist (
    organization_unit_id WITH =,
    position_type WITH =,
    daterange(COALESCE(effective_from, '-infinity'::date),
      COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD'));

ALTER TABLE organization_positions
  ADD CONSTRAINT organization_positions_unit_head_period
  EXCLUDE USING gist (
    organization_unit_id WITH =,
    daterange(COALESCE(effective_from, '-infinity'::date),
      COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (is_active AND is_unit_head);

CREATE TABLE organization_head_reconciliation_decisions (
  id BIGSERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
  organization_unit_id BIGINT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  legacy_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(40) NOT NULL CHECK (decision IN ('KEEP_EXISTING','MARK_LEGACY_OBSOLETE')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  decided_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX organization_head_reconciliation_current_uq
  ON organization_head_reconciliation_decisions(organization_unit_id) WHERE superseded_at IS NULL;
CREATE INDEX organization_head_reconciliation_decisions_scope_idx
  ON organization_head_reconciliation_decisions(institute_id, organization_unit_id, decided_at DESC);

COMMIT;