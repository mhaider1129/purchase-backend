-- MANUAL DATABASE MIGRATION REQUIRED. Forward-only; execute complete file manually
-- in Development first. Codex has not executed this patch against any database.
-- No rule's institute is inferred from its creator or assignee's current placement.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.notification_outbox') IS NULL OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.requests') IS NULL OR to_regclass('public.requested_items') IS NULL THEN
    RAISE EXCEPTION 'Canonical request, audit and transactional outbox prerequisites must be installed first';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='outbox_event_id') THEN
    RAISE EXCEPTION 'Canonical notification outbox delivery schema must be installed first';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='outbox_event_id'
    WHERE i.indrelid='public.notifications'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) THEN
    RAISE EXCEPTION 'Canonical in-app outbox notification uniqueness is required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='idempotency_key'
    WHERE i.indrelid='public.notification_outbox'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) THEN
    RAISE EXCEPTION 'Canonical transactional outbox event uniqueness is required';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.request_auto_assignment_rules (
  id SERIAL PRIMARY KEY, request_type VARCHAR(100) NOT NULL,
  warehouse_id INTEGER REFERENCES public.warehouses(id) ON DELETE CASCADE,
  assignee_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.request_auto_assignment_rules ADD COLUMN IF NOT EXISTS institute_id INTEGER;
LOCK TABLE public.request_auto_assignment_rules IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.request_auto_assignment_rules'::regclass AND conname='request_auto_assignment_rules_institute_fk') THEN
    ALTER TABLE public.request_auto_assignment_rules ADD CONSTRAINT request_auto_assignment_rules_institute_fk
      FOREIGN KEY(institute_id) REFERENCES public.institutes(id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.request_auto_assignment_rules r LEFT JOIN public.users u ON u.id=r.assignee_user_id
    LEFT JOIN public.warehouses w ON w.id=r.warehouse_id WHERE r.institute_id IS NOT NULL
    AND (u.institute_id IS DISTINCT FROM r.institute_id OR (r.warehouse_id IS NOT NULL AND w.institute_id IS DISTINCT FROM r.institute_id))) THEN
    RAISE EXCEPTION 'Scoped rule ownership conflicts with assignee/warehouse; reconcile explicitly before proceeding';
  END IF;
END $$;
-- Preserve every existing rule unchanged and NULL-owned until an owner reviews it.
-- New institute-owned rules may be configured through the secured Management UI.
-- Do not restore the old global index through the older baseline startup helper.
DROP INDEX IF EXISTS public.request_auto_assignment_rules_unique_scope;
CREATE UNIQUE INDEX IF NOT EXISTS request_auto_assignment_rules_institute_scope
 ON public.request_auto_assignment_rules(institute_id,LOWER(request_type),COALESCE(warehouse_id,0))
 WHERE institute_id IS NOT NULL;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid='public.request_auto_assignment_rules_institute_scope'::regclass
    AND (i.indrelid<>'public.request_auto_assignment_rules'::regclass OR NOT i.indisunique OR NOT i.indisvalid OR i.indnkeyatts<>3
      OR pg_get_indexdef(i.indexrelid,1,true) IS DISTINCT FROM 'institute_id'
      OR regexp_replace(pg_get_indexdef(i.indexrelid,2,true),'[[:space:]]','','g') NOT IN ('lower(request_type)','lower(request_type::text)','lower((request_type)::text)')
      OR regexp_replace(pg_get_indexdef(i.indexrelid,3,true),'[[:space:]]','','g') NOT IN ('COALESCE(warehouse_id,0)','COALESCE(warehouse_id,0::bigint)','COALESCE(warehouse_id,''0''::bigint)')
      OR pg_get_expr(i.indpred,i.indrelid) IS DISTINCT FROM '(institute_id IS NOT NULL)')) THEN
    RAISE EXCEPTION 'Autoassignment institute index has incompatible definition; reconcile explicitly';
  END IF;
END $$;
-- Existing item assignment columns, without request-time DDL on mutation paths.
ALTER TABLE public.requested_items
 ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS assignment_notes TEXT;
CREATE INDEX IF NOT EXISTS idx_requested_items_assigned_to ON public.requested_items(assigned_to);
CREATE INDEX IF NOT EXISTS idx_requested_items_request_assignee ON public.requested_items(request_id,assigned_to);
COMMIT;
