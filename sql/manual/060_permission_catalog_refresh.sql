-- MANUAL DATABASE MIGRATION REQUIRED. Add catalog metadata only; no grants.
-- Missing from the supplied permissions_Table.sql and required by surgicalConsignmentModel.
BEGIN;
SET LOCAL lock_timeout='3s';
LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE;
DO $sequence$ DECLARE sequence_name text; last_used bigint; maximum_id bigint; BEGIN
  sequence_name := pg_get_serial_sequence('public.permissions','id');
  -- A restored export may retain nextval(...) without an OWNED BY dependency.
  IF sequence_name IS NULL THEN
    SELECT seq.oid::regclass::text INTO sequence_name
      FROM pg_attribute a
      JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=ad.oid
      JOIN pg_class seq ON dep.refclassid='pg_class'::regclass AND seq.oid=dep.refobjid AND seq.relkind='S'
     WHERE a.attrelid='public.permissions'::regclass AND a.attname='id';
  END IF;
  SELECT max(id) INTO maximum_id FROM public.permissions;
  IF sequence_name IS NOT NULL AND maximum_id IS NOT NULL THEN
    EXECUTE format('SELECT last_value FROM %s',sequence_name::regclass) INTO last_used;
    IF last_used <= maximum_id THEN PERFORM setval(sequence_name::regclass,maximum_id,true); END IF;
  END IF;
END $sequence$;
INSERT INTO public.permissions(code,name,description) VALUES
 ('approval-authority.cmo','CMO clinical approval authority','Explicit clinical decision authority used by surgical consignment governance; assign only through reviewed existing permission management.')
ON CONFLICT(code) DO NOTHING;
COMMIT;
