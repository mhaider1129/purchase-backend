-- DEVELOPMENT ONLY. Manual deployment; ordinary task API requests perform no DDL.
-- Existing tasks are retained. Incompatible tables fail; never recreate a table.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $install$
DECLARE defects text; column_name text; existing_fk record;
BEGIN
  IF to_regclass('public.users') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_attribute
      WHERE attrelid='public.users'::regclass AND attname='id' AND atttypid='integer'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'DEV_TASKS_USERS_PREREQUISITE: expected public.users integer id';
  END IF;
  IF to_regclass('public.employee_tasks') IS NULL THEN
    CREATE TABLE public.employee_tasks (
      id serial PRIMARY KEY,title text NOT NULL,description text,
      assigned_to integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
      assigned_by integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'pending',employee_update text,
      assigned_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
  END IF;
  SELECT string_agg(expected.name,', ') INTO defects FROM (VALUES
    ('id','integer'::regtype,true),('title','text'::regtype,true),('description','text'::regtype,false),
    ('assigned_to','integer'::regtype,true),('assigned_by','integer'::regtype,true),('status','text'::regtype,true),
    ('employee_update','text'::regtype,false),('assigned_at','timestamptz'::regtype,true),
    ('updated_at','timestamptz'::regtype,true),('completed_at','timestamptz'::regtype,false)
  ) expected(name,type_id,required) LEFT JOIN pg_attribute a
    ON a.attrelid='public.employee_tasks'::regclass AND a.attname=expected.name AND NOT a.attisdropped
  WHERE a.attnum IS NULL OR a.atttypid<>expected.type_id OR a.attnotnull<>expected.required;
  IF defects IS NOT NULL THEN RAISE EXCEPTION 'DEV_TASKS_INCOMPATIBLE_COLUMNS: %. Review without rebuilding existing tasks',defects; END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.employee_tasks'::regclass AND attnum>0 AND NOT attisdropped)<>10 THEN
    RAISE EXCEPTION 'DEV_TASKS_UNEXPECTED_COLUMNS: review extensions before deployment';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.employee_tasks'::regclass
      AND c.contype='p' AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='id')]) THEN
    RAISE EXCEPTION 'DEV_TASKS_PRIMARY_KEY_INCOMPATIBLE: expected id primary key';
  END IF;
  IF pg_get_serial_sequence('public.employee_tasks','id') IS NULL THEN
    RAISE EXCEPTION 'DEV_TASKS_ID_GENERATION_INCOMPATIBLE: expected an owned serial/identity sequence; never reset IDs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.employee_tasks'::regclass AND a.attname='status'
      AND pg_get_expr(d.adbin,d.adrelid)='''pending''::text') THEN
    RAISE EXCEPTION 'DEV_TASKS_STATUS_DEFAULT_INCOMPATIBLE: expected pending';
  END IF;
  IF (SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.employee_tasks'::regclass AND a.attname IN ('assigned_at','updated_at')
      AND lower(pg_get_expr(d.adbin,d.adrelid)) IN ('now()','current_timestamp'))<>2 THEN
    RAISE EXCEPTION 'DEV_TASKS_TIMESTAMP_DEFAULT_INCOMPATIBLE: expected transaction timestamps';
  END IF;
  IF EXISTS(SELECT 1 FROM public.employee_tasks t LEFT JOIN public.users assignee ON assignee.id=t.assigned_to
      LEFT JOIN public.users assigner ON assigner.id=t.assigned_by WHERE assignee.id IS NULL OR assigner.id IS NULL) THEN
    RAISE EXCEPTION 'DEV_TASKS_ORPHAN_USERS: reconcile existing assignments without deleting tasks';
  END IF;
  FOREACH column_name IN ARRAY ARRAY['assigned_to','assigned_by'] LOOP
    FOR existing_fk IN SELECT c.* FROM pg_constraint c JOIN pg_attribute a
        ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.conrelid='public.employee_tasks'::regclass AND c.contype='f' AND a.attname=column_name LOOP
      IF existing_fk.confrelid<>'public.users'::regclass OR cardinality(existing_fk.conkey)<>1
          OR existing_fk.confkey<>ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname='id')]
          OR existing_fk.confdeltype NOT IN ('a','r') OR existing_fk.confupdtype<>'a'
          OR existing_fk.condeferrable OR NOT existing_fk.convalidated THEN
        RAISE EXCEPTION 'DEV_TASKS_FOREIGN_KEY_INCOMPATIBLE: %',existing_fk.conname;
      END IF;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.conrelid='public.employee_tasks'::regclass AND c.contype='f' AND a.attname=column_name) THEN
      EXECUTE format('ALTER TABLE public.employee_tasks ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE RESTRICT',
        'employee_tasks_'||column_name||'_fkey',column_name);
    END IF;
  END LOOP;
END $install$;

-- Existing same-named indexes must have the exact one-column nonpartial key.
DO $indexes$
DECLARE column_name text; index_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY['assigned_to','assigned_by'] LOOP
    index_name := 'idx_employee_tasks_'||column_name;
    IF to_regclass('public.'||index_name) IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_am am ON am.oid=idx.relam
      WHERE i.indexrelid=to_regclass('public.'||index_name) AND i.indrelid='public.employee_tasks'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=1 AND i.indnatts=1
      AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree'
      AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname=column_name)) THEN
      RAISE EXCEPTION 'DEV_TASKS_INDEX_INCOMPATIBLE: %',index_name;
    END IF;
    IF to_regclass('public.'||index_name) IS NULL THEN
      EXECUTE format('CREATE INDEX %I ON public.employee_tasks (%I)',index_name,column_name);
    END IF;
  END LOOP;
END $indexes$;
COMMIT;

-- Expected: compatible columns/defaults, two user FKs, two valid indexes; task
-- row count and existing IDs unchanged. No automatic grants or RLS changes.
SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='employee_tasks' ORDER BY ordinal_position;
SELECT conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.employee_tasks'::regclass;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='employee_tasks';
SELECT count(*) task_rows,min(id) first_id,max(id) last_id FROM public.employee_tasks;
SELECT pg_get_serial_sequence('public.employee_tasks','id') owned_sequence;
