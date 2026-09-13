-- 025: Bind work-order part reservation and issue state to canonical inventory facts.
-- FORWARD-ONLY. Run manually after 004, 005 and 024.
BEGIN;
DO $migration$
BEGIN
  IF to_regclass('public.maintenance_work_order_parts') IS NULL OR to_regclass('public.inventory_reservations') IS NULL
     OR to_regclass('public.inventory_transactions') IS NULL THEN RAISE EXCEPTION 'SQL_025_DEPENDENCY_MISSING_OR_INCOMPATIBLE'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maintenance_work_order_parts' AND column_name='reservation_id') THEN
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maintenance_work_order_parts' AND column_name='issued_inventory_movement_id') AND to_regclass('public.maintenance_part_inventory_operations') IS NOT NULL THEN RAISE NOTICE 'SQL_025_ALREADY_APPLIED_COMPATIBLE';RETURN;END IF;
    RAISE EXCEPTION 'SQL_025_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;
  ALTER TABLE public.maintenance_work_order_parts
    ADD COLUMN reservation_id bigint REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT,
    ADD COLUMN issued_inventory_movement_id integer REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
    ADD COLUMN reserved_at timestamptz,ADD COLUMN issued_at timestamptz;
  ALTER TABLE public.maintenance_work_order_parts
    ADD CONSTRAINT maintenance_work_order_parts_institute_id_id_uq UNIQUE(institute_id,id);
  CREATE UNIQUE INDEX maintenance_work_order_parts_reservation_uq ON public.maintenance_work_order_parts(reservation_id) WHERE reservation_id IS NOT NULL;
  CREATE INDEX maintenance_work_order_parts_movement_idx ON public.maintenance_work_order_parts(issued_inventory_movement_id) WHERE issued_inventory_movement_id IS NOT NULL;
  CREATE TABLE public.maintenance_part_inventory_operations(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES public.institutes(id),work_order_part_id bigint NOT NULL,
    operation_type text NOT NULL CHECK(operation_type IN('RESERVE','ISSUE','RELEASE','RETURN')),
    quantity numeric(18,6) NOT NULL CHECK(quantity>0),idempotency_key text NOT NULL,
    reservation_id bigint REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT,
    inventory_movement_id integer REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
    created_by integer NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(institute_id,work_order_part_id) REFERENCES public.maintenance_work_order_parts(institute_id,id) ON DELETE RESTRICT,
    UNIQUE(institute_id,operation_type,idempotency_key)
  );
  CREATE INDEX maintenance_part_inventory_operations_part_idx ON public.maintenance_part_inventory_operations(work_order_part_id,created_at);
END $migration$;
COMMIT;