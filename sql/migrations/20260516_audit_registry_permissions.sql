BEGIN;

INSERT INTO public.permissions (code, name, description)
VALUES ('requests.view-audit', 'View audit requests', 'View audit requests page')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO public.ui_resource_permissions (
  resource_key,
  label,
  description,
  permissions,
  require_all
)
VALUES (
  'feature.auditRequests',
  'Audit Requests',
  'Allows access to the audit review workspace.',
  ARRAY['requests.view-audit'],
  FALSE
)
ON CONFLICT (resource_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    permissions = EXCLUDED.permissions,
    require_all = EXCLUDED.require_all;

COMMIT;