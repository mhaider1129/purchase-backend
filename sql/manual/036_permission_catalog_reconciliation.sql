-- MANUAL DATABASE MIGRATION REQUIRED. Add missing catalog definitions, never role/user grants.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE;
-- Exported IDs may be ahead of the sequence. Advance only when it is behind; never lower it.
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
 ('approval-authority.ceo','CEO approval authority','Capability holder for the approval-authority.ceo approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.'),
 ('approval-authority.cfo','CFO approval authority','Capability holder for the approval-authority.cfo approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.'),
 ('approval-authority.coo','COO approval authority','Capability holder for the approval-authority.coo approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.'),
 ('approval-authority.medical-devices','Medical devices approval authority','Capability holder for the approval-authority.medical-devices approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.'),
 ('approval-authority.supply-chain','Supply chain approval authority','Capability holder for the approval-authority.supply-chain approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.'),
 ('approval-authority.warehouse','Warehouse approval authority','Capability holder for the approval-authority.warehouse approval-policy resolver; assign explicitly to the appropriate institute-scoped authority role.')
ON CONFLICT(code) DO NOTHING;
-- No INSERT/UPDATE is made to role_permissions or user_permissions.
COMMIT;
