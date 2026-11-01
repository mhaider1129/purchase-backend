-- OPTIONAL MANUAL POLICY ALIGNMENT. Review before applying.
-- The supplied export has an empty demand-planning permission list. Current backend
-- defaults require one of the named planning capabilities. This narrows UI visibility.
-- Preserve labels/descriptions and any policy that no longer exactly matches the export.
BEGIN;
WITH changed AS (
 UPDATE public.ui_resource_permissions
 SET permissions=ARRAY['planning.view','planning.manage','replenishment.manage']::text[],require_all=false
 WHERE resource_key='feature.demandPlanning' AND permissions=ARRAY[]::text[] AND require_all=false
 RETURNING resource_key,permissions,require_all
)
INSERT INTO public.audit_logs(action,action_type,target_type,target_id,description,details)
SELECT 'ui_resource.policy_aligned','ui_resource.policy_aligned','ui_resource_permissions',NULL,
 'Manual SQL 062: align exact exported demand-planning policy with current backend defaults',
 jsonb_build_object('resource_key',resource_key,'beforeData',jsonb_build_object('permissions','[]'::jsonb,'require_all',false),'afterData',to_jsonb(changed),'databaseRole',current_user)
FROM changed;
COMMIT;
