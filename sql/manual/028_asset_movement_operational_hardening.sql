-- 028: Enforce one active movement and link canonical return movements.
-- FORWARD-ONLY. Run manually after 027; never from application startup.
BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.asset_movements') IS NULL THEN
    RAISE EXCEPTION 'SQL_028_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM asset_movements
    WHERE status IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT')
    GROUP BY institute_id,asset_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'SQL_028_ACTIVE_MOVEMENT_CONFLICT';
  END IF;
END
$migration$;

ALTER TABLE asset_movements
  ADD COLUMN origin_movement_id bigint NULL
    REFERENCES asset_movements(id);

CREATE UNIQUE INDEX asset_movements_one_active_uq
  ON asset_movements(institute_id,asset_id)
  WHERE status IN ('PENDING_APPROVAL','APPROVED','IN_TRANSIT');

CREATE UNIQUE INDEX asset_movements_return_origin_uq
  ON asset_movements(origin_movement_id)
  WHERE movement_type='RETURN';

ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_return_origin_ck
  CHECK (
    (movement_type='RETURN' AND origin_movement_id IS NOT NULL)
    OR (movement_type<>'RETURN' AND origin_movement_id IS NULL)
  );

COMMIT;