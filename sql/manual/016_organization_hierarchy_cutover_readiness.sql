-- 016: Organization hierarchy cutover readiness. MANUAL/PENDING; depends on deployed 014.
-- This file is intentionally not executed by the application.
-- btree_gist is installed only in the verified clean state, inside this transaction. The
-- extension catalog and required GiST operator classes are verified before dependent DDL.
BEGIN;

DO $preflight$
DECLARE
  old_authority regclass := to_regclass('public.organization_positions_unique_authority_uq');
  old_unit_head regclass := to_regclass('public.organization_positions_unit_head_uq');
  new_authority oid;
  new_unit_head oid;
  reconciliation regclass := to_regclass('public.organization_head_reconciliation_decisions');
  unexpected text;
  overlap_record record;
  complete_compatible boolean := false;
BEGIN
  SELECT oid INTO new_authority FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='organization_positions_unique_authority_period';
  SELECT oid INTO new_unit_head FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='organization_positions_unit_head_period';

  -- COMPLETE 016: validate every replacement object, including expression order and predicates.
  IF new_authority IS NOT NULL AND new_unit_head IS NOT NULL AND reconciliation IS NOT NULL
     AND old_authority IS NULL AND old_unit_head IS NULL THEN
    complete_compatible :=
      EXISTS (SELECT 1 FROM pg_constraint c WHERE c.oid=new_authority AND c.contype='x'
        AND c.conrelid='public.organization_positions'::regclass
        AND regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g') ~ 'EXCLUDE USING gist \(organization_unit_id WITH =, position_type WITH =, daterange\(COALESCE\(effective_from, .-infinity.::date\), COALESCE\(\(effective_to \+ 1\), .infinity.::date\), .\[\).::text\) WITH &&\) WHERE \(\(is_active AND \(\(position_type\)::text = ANY \(\(ARRAY\[.UNIT_HEAD.::character varying, .EXECUTIVE_HEAD.::character varying, .DEPARTMENT_HEAD.::character varying, .SECTION_HEAD.::character varying\]\)::text\[\]\)\)\)\)')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.oid=new_unit_head AND c.contype='x'
        AND c.conrelid='public.organization_positions'::regclass
        AND regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g') ~ 'EXCLUDE USING gist \(organization_unit_id WITH =, daterange\(COALESCE\(effective_from, .-infinity.::date\), COALESCE\(\(effective_to \+ 1\), .infinity.::date\), .\[\).::text\) WITH &&\) WHERE \(\(is_active AND is_unit_head\)\)')
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('id','bigint','NO'),('institute_id','integer','NO'),('organization_unit_id','bigint','NO'),
          ('legacy_user_id','integer','NO'),('organization_head_position_id','bigint','NO'),
          ('organization_head_user_id','integer','NO'),('decision','character varying','NO'),
          ('reason','text','NO'),('decided_by','integer','NO'),('decided_at','timestamp with time zone','NO'),
          ('superseded_at','timestamp with time zone','YES')
        ) e(column_name,data_type,is_nullable)
        WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
          AND c.table_name='organization_head_reconciliation_decisions' AND c.column_name=e.column_name
          AND c.data_type=e.data_type AND c.is_nullable=e.is_nullable))
      AND (SELECT count(*) FROM pg_constraint WHERE conrelid=reconciliation AND contype='p')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(institute_id\) REFERENCES institutes\(id\) ON DELETE RESTRICT')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(organization_unit_id\) REFERENCES organization_units\(id\) ON DELETE RESTRICT')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(legacy_user_id\) REFERENCES users\(id\) ON DELETE RESTRICT')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(organization_head_position_id\) REFERENCES organization_positions\(id\) ON DELETE RESTRICT')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(organization_head_user_id\) REFERENCES users\(id\) ON DELETE RESTRICT')=1
      AND (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='f'
        AND pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \(decided_by\) REFERENCES users\(id\) ON DELETE RESTRICT')=1
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='c'
        AND pg_get_constraintdef(c.oid) LIKE '%decision%KEEP_EXISTING%MARK_LEGACY_OBSOLETE%')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=reconciliation AND c.contype='c'
        AND pg_get_constraintdef(c.oid) LIKE '%length%trim%reason%> 0%')
      AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.organization_head_reconciliation_current_uq')
        AND i.indrelid=reconciliation AND i.indisunique AND i.indnkeyatts=1
        AND pg_get_indexdef(i.indexrelid,1,true)='organization_unit_id'
        AND regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[()]','','g')='superseded_at IS NULL')
      AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.organization_head_reconciliation_decisions_scope_idx')
        AND i.indrelid=reconciliation AND NOT i.indisunique AND i.indnkeyatts=3
        AND pg_get_indexdef(i.indexrelid,1,true)='institute_id'
        AND pg_get_indexdef(i.indexrelid,2,true)='organization_unit_id'
        AND pg_get_indexdef(i.indexrelid,3,true)='decided_at DESC' AND i.indpred IS NULL);
    IF complete_compatible THEN
      PERFORM set_config('purchase_tracker.sql_016_install','false',true);
      RAISE NOTICE 'SQL_016_ALREADY_APPLIED_COMPATIBLE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'SQL_016_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  -- CLEAN ABSENT: no 016 artifact may exist and both 014 indexes must match exactly.
  IF new_authority IS NOT NULL OR new_unit_head IS NOT NULL OR reconciliation IS NOT NULL
     OR to_regclass('public.organization_head_reconciliation_current_uq') IS NOT NULL
     OR to_regclass('public.organization_head_reconciliation_decisions_scope_idx') IS NOT NULL
     OR old_authority IS NULL OR old_unit_head IS NULL
     OR to_regclass('public.organization_positions') IS NULL THEN
    RAISE EXCEPTION 'SQL_016_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=old_authority
      AND i.indrelid='public.organization_positions'::regclass AND i.indisunique AND i.indnkeyatts=2
      AND pg_get_indexdef(i.indexrelid,1,true)='organization_unit_id'
      AND pg_get_indexdef(i.indexrelid,2,true)='position_type'
      AND pg_get_expr(i.indpred,i.indrelid) LIKE '%is_active%'
      AND pg_get_expr(i.indpred,i.indrelid) LIKE ALL (ARRAY['%UNIT_HEAD%','%EXECUTIVE_HEAD%','%DEPARTMENT_HEAD%','%SECTION_HEAD%']))
    OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=old_unit_head
      AND i.indrelid='public.organization_positions'::regclass AND i.indisunique AND i.indnkeyatts=1
      AND pg_get_indexdef(i.indexrelid,1,true)='organization_unit_id'
      AND regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[()]','','g')='is_active AND is_unit_head') THEN
    RAISE EXCEPTION 'SQL_016_PARTIAL_OR_DRIFTED_SCHEMA';
  END IF;

  -- Report representative conflicting IDs; never repair authority data here.
  SELECT a.id first_id,b.id second_id,a.organization_unit_id,a.position_type INTO overlap_record
  FROM organization_positions a JOIN organization_positions b ON b.id>a.id
   AND b.organization_unit_id=a.organization_unit_id AND b.position_type=a.position_type
   AND b.is_active AND b.position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD')
   AND daterange(COALESCE(a.effective_from,'-infinity'),COALESCE(a.effective_to+1,'infinity'),'[)') &&
       daterange(COALESCE(b.effective_from,'-infinity'),COALESCE(b.effective_to+1,'infinity'),'[)')
  WHERE a.is_active AND a.position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD') LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'SQL_016_AUTHORITY_PERIOD_OVERLAP unit=%, type=%, position_ids=%,%',overlap_record.organization_unit_id,overlap_record.position_type,overlap_record.first_id,overlap_record.second_id; END IF;
  SELECT a.id first_id,b.id second_id,a.organization_unit_id INTO overlap_record
  FROM organization_positions a JOIN organization_positions b ON b.id>a.id AND b.organization_unit_id=a.organization_unit_id
   AND b.is_active AND b.is_unit_head
   AND daterange(COALESCE(a.effective_from,'-infinity'),COALESCE(a.effective_to+1,'infinity'),'[)') && daterange(COALESCE(b.effective_from,'-infinity'),COALESCE(b.effective_to+1,'infinity'),'[)')
  WHERE a.is_active AND a.is_unit_head LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'SQL_016_UNIT_HEAD_PERIOD_OVERLAP unit=%, position_ids=%,%',overlap_record.organization_unit_id,overlap_record.first_id,overlap_record.second_id; END IF;
  PERFORM set_config('purchase_tracker.sql_016_install','true',true);
END $preflight$;

DO $extension$
BEGIN
  IF current_setting('purchase_tracker.sql_016_install')='true' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='btree_gist') THEN RAISE EXCEPTION 'SQL_016_PARTIAL_OR_DRIFTED_SCHEMA: btree_gist unavailable'; END IF;
      EXECUTE 'CREATE EXTENSION btree_gist';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_opclass WHERE opcname IN ('int8_ops','text_ops') AND opcmethod=(SELECT oid FROM pg_am WHERE amname='gist') GROUP BY opcmethod HAVING count(DISTINCT opcname)=2) THEN
      RAISE EXCEPTION 'SQL_016_PARTIAL_OR_DRIFTED_SCHEMA: btree_gist operator classes unavailable';
    END IF;
  END IF;
END $extension$;

DO $install$
BEGIN
 IF current_setting('purchase_tracker.sql_016_install')='true' THEN
  -- No IF EXISTS: the preflight proved both exact source definitions before either drop.
  EXECUTE 'DROP INDEX public.organization_positions_unique_authority_uq';
  EXECUTE 'DROP INDEX public.organization_positions_unit_head_uq';
  EXECUTE $ddl$ALTER TABLE organization_positions ADD CONSTRAINT organization_positions_unique_authority_period EXCLUDE USING gist (organization_unit_id WITH =,position_type WITH =,daterange(COALESCE(effective_from,'-infinity'::date),COALESCE(effective_to+1,'infinity'::date),'[)') WITH &&) WHERE (is_active AND position_type IN ('UNIT_HEAD','EXECUTIVE_HEAD','DEPARTMENT_HEAD','SECTION_HEAD'))$ddl$;
  EXECUTE $ddl$ALTER TABLE organization_positions ADD CONSTRAINT organization_positions_unit_head_period EXCLUDE USING gist (organization_unit_id WITH =,daterange(COALESCE(effective_from,'-infinity'::date),COALESCE(effective_to+1,'infinity'::date),'[)') WITH &&) WHERE (is_active AND is_unit_head)$ddl$;
  EXECUTE $ddl$CREATE TABLE organization_head_reconciliation_decisions (
    id BIGSERIAL PRIMARY KEY,
    institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
    organization_unit_id BIGINT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
    legacy_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organization_head_position_id BIGINT NOT NULL REFERENCES organization_positions(id) ON DELETE RESTRICT,
    organization_head_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decision VARCHAR(40) NOT NULL CHECK (decision IN ('KEEP_EXISTING','MARK_LEGACY_OBSOLETE')),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0), decided_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ)$ddl$;
  EXECUTE 'CREATE UNIQUE INDEX organization_head_reconciliation_current_uq ON organization_head_reconciliation_decisions(organization_unit_id) WHERE superseded_at IS NULL';
  EXECUTE 'CREATE INDEX organization_head_reconciliation_decisions_scope_idx ON organization_head_reconciliation_decisions(institute_id,organization_unit_id,decided_at DESC)';
 END IF;
END $install$;
COMMIT;