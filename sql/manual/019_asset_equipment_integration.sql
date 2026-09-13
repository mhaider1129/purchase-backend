-- 019: Make the Asset Register authoritative for maintainable-equipment identity.
-- FORWARD-ONLY. Run manually after 013 and 017; never from application startup.
BEGIN;

DO $migration$
DECLARE
  asset_link_exists boolean;
  asset_link_fk_exists boolean;
  asset_link_uq_exists boolean;
BEGIN
  IF to_regclass('public.assets') IS NULL OR to_regclass('public.maintainable_equipment') IS NULL
     OR to_regclass('public.permissions') IS NULL OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'SQL_019_DEPENDENCY_MISSING';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='maintainable_equipment'
      AND column_name='asset_id' AND data_type='bigint' AND is_nullable='YES'
  ) INTO asset_link_exists;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.maintainable_equipment'::regclass
      AND conname='maintainable_equipment_asset_scope_fk' AND contype='f'
  ) INTO asset_link_fk_exists;
  SELECT to_regclass('public.maintainable_equipment_asset_uq') IS NOT NULL INTO asset_link_uq_exists;

  IF asset_link_exists AND asset_link_fk_exists AND asset_link_uq_exists THEN
    RAISE NOTICE 'SQL_019_ALREADY_APPLIED_COMPATIBLE';
  ELSIF asset_link_exists OR asset_link_fk_exists OR asset_link_uq_exists THEN
    RAISE EXCEPTION 'SQL_019_PARTIAL_OR_DRIFTED_SCHEMA';
  ELSE
    -- The redundant institute/id key permits a tenant-safe composite FK. Existing
    -- unlinked equipment remains valid so that legacy matching can be reviewed.
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_institute_id_id_uq UNIQUE (institute_id,id);
    ALTER TABLE public.maintainable_equipment ADD COLUMN asset_id bigint;
    ALTER TABLE public.maintainable_equipment
      ADD CONSTRAINT maintainable_equipment_asset_scope_fk
      FOREIGN KEY (institute_id,asset_id)
      REFERENCES public.assets(institute_id,id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX maintainable_equipment_asset_uq
      ON public.maintainable_equipment(asset_id) WHERE asset_id IS NOT NULL;
    CREATE INDEX maintainable_equipment_institute_asset_idx
      ON public.maintainable_equipment(institute_id,asset_id) WHERE asset_id IS NOT NULL;
  END IF;

  INSERT INTO public.permissions(code,name,description) VALUES
    ('equipment.view','View maintainable equipment','View institute-scoped equipment and its authoritative Asset link'),
    ('equipment.manage','Manage maintainable equipment','Create, link and update maintainable-equipment profiles')
  ON CONFLICT (code) DO NOTHING;

  -- Preserve access during endpoint extraction: roles that could view spare parts
  -- can view Equipment, and compatibility managers retain equipment write access.
  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT DISTINCT rp.role_id,target.id
  FROM public.role_permissions rp
  JOIN public.permissions source ON source.id=rp.permission_id
  JOIN public.permissions target ON target.code='equipment.view'
  WHERE source.code='spare-parts.view'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT DISTINCT rp.role_id,target.id
  FROM public.role_permissions rp
  JOIN public.permissions source ON source.id=rp.permission_id
  JOIN public.permissions target ON target.code='equipment.manage'
  WHERE source.code='spare-parts.manage-compatibility'
  ON CONFLICT DO NOTHING;
END $migration$;

COMMIT;