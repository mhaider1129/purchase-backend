-- 032: Approval Engine 2.0 operationalization phase 1
-- MANUAL/PENDING — NOT EXECUTED. Apply to Development first; promote this exact file only after validation.
BEGIN;
DO $gate$
DECLARE
  table_count integer;
  auxiliary_count integer;
  compatible boolean;
BEGIN
  IF to_regclass('public.organization_units') IS NULL OR to_regclass('public.organization_positions') IS NULL
     OR to_regclass('public.approval_policy_versions') IS NULL OR to_regclass('public.approval_policy_rule_steps') IS NULL
     OR to_regclass('public.approvals') IS NULL OR to_regclass('public.requests') IS NULL THEN
    RAISE EXCEPTION 'SQL_032_MISSING_PREREQUISITE: manually apply governed migrations 014-016 before 032';
  END IF;

  SELECT count(*) INTO table_count FROM (VALUES
    ('approval_authority_delegations'),('approval_route_snapshots'),('approval_route_snapshot_steps')) x(name)
    WHERE to_regclass('public.'||name) IS NOT NULL;
  SELECT count(*) INTO auxiliary_count FROM (VALUES
    ('approval_route_snapshot_guard'),('approval_route_snapshot_validate')) x(name)
    WHERE to_regprocedure('public.'||name||'()') IS NOT NULL;

  IF table_count=0 AND auxiliary_count=0 THEN
    PERFORM set_config('purchase_tracker.sql_032_install','true',true);
    RETURN;
  END IF;
  IF table_count<>3 OR auxiliary_count<>2 THEN RAISE EXCEPTION 'SQL_032_PARTIAL_OR_DRIFTED'; END IF;

  /* A rerun is accepted only after proving every material 032 contract. Constraint
     names below are stable because 032 owns them; generated PK/FK names are not used. */
  compatible :=
    (SELECT count(*)=19 FROM information_schema.columns c JOIN (VALUES
      ('id','bigint','NO'),('institute_id','integer','NO'),('organization_position_id','bigint','YES'),
      ('delegator_user_id','integer','YES'),('delegate_user_id','integer','NO'),('effective_from','timestamp with time zone','NO'),
      ('effective_to','timestamp with time zone','NO'),('scope','character varying','NO'),('reason','text','NO'),
      ('status','character varying','NO'),('created_by','integer','NO'),('created_at','timestamp with time zone','NO'),
      ('revoked_by','integer','YES'),('revoked_at','timestamp with time zone','YES'),('revocation_reason','text','YES'),
      ('row_version','integer','NO'),('authority_kind','text','NO'),('authority_id','bigint','NO'),
      ('effective_period','tstzrange','YES')) expected(name,type,nullable)
      ON c.column_name=expected.name AND c.data_type=expected.type AND c.is_nullable=expected.nullable
      WHERE c.table_schema='public' AND c.table_name='approval_authority_delegations')
    AND (SELECT count(*)=13 FROM information_schema.columns c JOIN (VALUES
      ('id','bigint','NO'),('institute_id','integer','NO'),('request_id','integer','NO'),('policy_id','bigint','NO'),
      ('policy_version_id','bigint','NO'),('generation_number','integer','NO'),('supersedes_snapshot_id','bigint','YES'),
      ('generation_reason','text','YES'),('facts_snapshot','jsonb','NO'),('route_generation_context','jsonb','NO'),
      ('generated_at','timestamp with time zone','NO'),('generated_by','integer','YES'),('row_version','integer','NO')) expected(name,type,nullable)
      ON c.column_name=expected.name AND c.data_type=expected.type AND c.is_nullable=expected.nullable
      WHERE c.table_schema='public' AND c.table_name='approval_route_snapshots')
    AND (SELECT count(*)=18 FROM information_schema.columns c JOIN (VALUES
      ('id','bigint','NO'),('snapshot_id','bigint','NO'),('policy_rule_id','bigint','YES'),('policy_step_id','bigint','YES'),
      ('sequence','integer','NO'),('approval_level','integer','NO'),('parallel_group','character varying','YES'),
      ('semantic_key','character varying','NO'),('required_authority','text','NO'),('resolved_unit_id','bigint','YES'),
      ('resolved_position_id','bigint','YES'),('structural_holder_id','integer','YES'),('acting_approver_id','integer','YES'),
      ('delegation_id','bigint','YES'),('resolution_type','character varying','NO'),('resolution_reason','text','YES'),
      ('generated_at','timestamp with time zone','NO'),('row_version','integer','NO')) expected(name,type,nullable)
      ON c.column_name=expected.name AND c.data_type=expected.type AND c.is_nullable=expected.nullable
      WHERE c.table_schema='public' AND c.table_name='approval_route_snapshot_steps')
    AND (SELECT count(*)=16 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN(
      'approval_delegation_authority_ck','approval_delegation_self_ck','approval_delegation_period_ck',
      'approval_delegation_status_ck','approval_delegation_row_version_ck','approval_delegation_revocation_ck','approval_delegation_no_overlap_excl',
      'approval_snapshot_generation_ck','approval_snapshot_generation_uq','approval_snapshot_supersedes_uq',
      'approval_snapshot_row_version_ck','approval_snapshot_step_sequence_ck','approval_snapshot_step_level_ck',
      'approval_snapshot_step_resolution_ck','approval_snapshot_step_row_version_ck','approval_snapshot_step_sequence_uq'))
    AND NOT EXISTS (SELECT 1 FROM (VALUES
      ('approval_authority_delegations_effective_idx'),('approval_authority_delegations_position_idx'),
      ('approval_authority_delegations_delegator_idx'),('approval_route_snapshots_request_idx'),
      ('approval_route_snapshot_steps_approver_idx')) expected(name)
      WHERE to_regclass('public.'||expected.name) IS NULL)
    AND (SELECT count(*)=2 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
      ('approval_route_snapshots_validate_trg','approval_route_snapshots_immutable_trg') AND tgrelid='public.approval_route_snapshots'::regclass)
    AND (SELECT count(*)=1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='approval_route_snapshot_steps_immutable_trg'
      AND tgrelid='public.approval_route_snapshot_steps'::regclass)
    AND (SELECT count(*)=3 FROM permissions WHERE code IN
      ('approval-delegation.view','approval-delegation.manage','approval-policy.simulate'))
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_policy_shadow_steps_resolution_status_check'
      AND conrelid='public.approval_policy_shadow_steps'::regclass
      AND pg_get_constraintdef(oid) LIKE '%DUPLICATE_PRINCIPAL%');

  /* Material FK targets and generated expressions are checked independently. */
  compatible := compatible
    AND (SELECT count(*)=20 FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY lk(attnum,n) ON true
      JOIN LATERAL unnest(c.confkey) WITH ORDINALITY fk(attnum,n) ON fk.n=lk.n
      JOIN pg_attribute la ON la.attrelid=c.conrelid AND la.attnum=lk.attnum
      JOIN pg_attribute fa ON fa.attrelid=c.confrelid AND fa.attnum=fk.attnum
      JOIN (VALUES
        ('approval_authority_delegations','institute_id','institutes','id'),('approval_authority_delegations','organization_position_id','organization_positions','id'),
        ('approval_authority_delegations','delegator_user_id','users','id'),('approval_authority_delegations','delegate_user_id','users','id'),
        ('approval_authority_delegations','created_by','users','id'),('approval_authority_delegations','revoked_by','users','id'),
        ('approval_route_snapshots','institute_id','institutes','id'),('approval_route_snapshots','request_id','requests','id'),
        ('approval_route_snapshots','policy_id','approval_policies','id'),('approval_route_snapshots','policy_version_id','approval_policy_versions','id'),
        ('approval_route_snapshots','supersedes_snapshot_id','approval_route_snapshots','id'),('approval_route_snapshots','generated_by','users','id'),
        ('approval_route_snapshot_steps','snapshot_id','approval_route_snapshots','id'),('approval_route_snapshot_steps','policy_rule_id','approval_policy_rules','id'),
        ('approval_route_snapshot_steps','policy_step_id','approval_policy_rule_steps','id'),('approval_route_snapshot_steps','resolved_unit_id','organization_units','id'),
        ('approval_route_snapshot_steps','resolved_position_id','organization_positions','id'),('approval_route_snapshot_steps','structural_holder_id','users','id'),
        ('approval_route_snapshot_steps','acting_approver_id','users','id'),('approval_route_snapshot_steps','delegation_id','approval_authority_delegations','id')
      ) expected(local_table,local_column,foreign_table,foreign_column)
      ON c.conrelid=('public.'||expected.local_table)::regclass AND la.attname=expected.local_column
        AND c.confrelid=('public.'||expected.foreign_table)::regclass AND fa.attname=expected.foreign_column
      WHERE c.contype='f')
    AND EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.approval_authority_delegations'::regclass AND a.attname='authority_id'
      AND pg_get_expr(d.adbin,d.adrelid) LIKE '%organization_position_id%delegator_user_id%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_delegation_no_overlap_excl'
      AND pg_get_constraintdef(oid) LIKE '%EXCLUDE USING gist%effective_period WITH &&%status =%ACTIVE%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_delegation_status_ck' AND pg_get_constraintdef(oid) LIKE '%ACTIVE%REVOKED%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_delegation_self_ck' AND pg_get_constraintdef(oid) LIKE '%delegate_user_id IS DISTINCT FROM delegator_user_id%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_delegation_period_ck' AND pg_get_constraintdef(oid) LIKE '%effective_to > effective_from%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_delegation_revocation_ck' AND pg_get_constraintdef(oid) LIKE '%revoked_by IS NULL%revoked_by IS NOT NULL%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_snapshot_generation_ck' AND pg_get_constraintdef(oid) LIKE '%generation_number >= 1%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approval_snapshot_step_resolution_ck' AND pg_get_constraintdef(oid) LIKE '%AMBIGUOUS%DUPLICATE_PRINCIPAL%');

  IF NOT compatible THEN RAISE EXCEPTION 'SQL_032_PARTIAL_OR_DRIFTED'; END IF;
  RAISE NOTICE 'SQL_032_COMPLETE_COMPATIBLE';
END $gate$;

DO $install$
BEGIN
IF current_setting('purchase_tracker.sql_032_install',true) IS DISTINCT FROM 'true' THEN RETURN; END IF;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE approval_authority_delegations(
 id BIGSERIAL PRIMARY KEY,institute_id INTEGER NOT NULL REFERENCES institutes(id),organization_position_id BIGINT REFERENCES organization_positions(id),
 delegator_user_id INTEGER REFERENCES users(id),delegate_user_id INTEGER NOT NULL REFERENCES users(id),effective_from TIMESTAMPTZ NOT NULL,effective_to TIMESTAMPTZ NOT NULL,
 scope VARCHAR(80) NOT NULL,reason TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
 created_by INTEGER NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),revoked_by INTEGER REFERENCES users(id),revoked_at TIMESTAMPTZ,
 revocation_reason TEXT,row_version INTEGER NOT NULL DEFAULT 1,
 authority_kind TEXT GENERATED ALWAYS AS (CASE WHEN organization_position_id IS NOT NULL THEN 'POSITION' ELSE 'USER' END) STORED,
 authority_id BIGINT GENERATED ALWAYS AS (COALESCE(organization_position_id,delegator_user_id::bigint)) STORED,
 effective_period TSTZRANGE GENERATED ALWAYS AS (tstzrange(effective_from,effective_to,'[)')) STORED,
 CONSTRAINT approval_delegation_authority_ck CHECK(organization_position_id IS NOT NULL OR delegator_user_id IS NOT NULL),
 CONSTRAINT approval_delegation_self_ck CHECK(delegate_user_id IS DISTINCT FROM delegator_user_id),
 CONSTRAINT approval_delegation_period_ck CHECK(effective_to>effective_from),
 CONSTRAINT approval_delegation_status_ck CHECK(status IN('ACTIVE','REVOKED')),
 CONSTRAINT approval_delegation_row_version_ck CHECK(row_version>0),
 CONSTRAINT approval_delegation_revocation_ck CHECK((status='ACTIVE' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL) OR (status='REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(btrim(revocation_reason))>0)),
 CONSTRAINT approval_delegation_no_overlap_excl EXCLUDE USING gist
   (institute_id WITH =,authority_kind WITH =,authority_id WITH =,scope WITH =,effective_period WITH &&) WHERE (status='ACTIVE')
);
CREATE INDEX approval_authority_delegations_effective_idx ON approval_authority_delegations(institute_id,scope,effective_from,effective_to) WHERE status='ACTIVE';
CREATE INDEX approval_authority_delegations_position_idx ON approval_authority_delegations(organization_position_id) WHERE status='ACTIVE';
CREATE INDEX approval_authority_delegations_delegator_idx ON approval_authority_delegations(delegator_user_id) WHERE status='ACTIVE';

CREATE TABLE approval_route_snapshots(
 id BIGSERIAL PRIMARY KEY,institute_id INTEGER NOT NULL REFERENCES institutes(id),request_id INTEGER NOT NULL REFERENCES requests(id),
 policy_id BIGINT NOT NULL REFERENCES approval_policies(id),policy_version_id BIGINT NOT NULL REFERENCES approval_policy_versions(id),
 generation_number INTEGER NOT NULL,generation_reason TEXT,supersedes_snapshot_id BIGINT REFERENCES approval_route_snapshots(id),
 facts_snapshot JSONB NOT NULL,route_generation_context JSONB NOT NULL DEFAULT '{}'::jsonb,
 generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),generated_by INTEGER REFERENCES users(id),row_version INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT approval_snapshot_generation_ck CHECK(generation_number>=1),
 CONSTRAINT approval_snapshot_row_version_ck CHECK(row_version=1),
 CONSTRAINT approval_snapshot_generation_uq UNIQUE(request_id,generation_number),
 CONSTRAINT approval_snapshot_supersedes_uq UNIQUE(supersedes_snapshot_id)
);
CREATE INDEX approval_route_snapshots_request_idx ON approval_route_snapshots(institute_id,request_id,generation_number DESC);
CREATE TABLE approval_route_snapshot_steps(
 id BIGSERIAL PRIMARY KEY,snapshot_id BIGINT NOT NULL REFERENCES approval_route_snapshots(id),policy_rule_id BIGINT REFERENCES approval_policy_rules(id),policy_step_id BIGINT REFERENCES approval_policy_rule_steps(id),
 sequence INTEGER NOT NULL,approval_level INTEGER NOT NULL,parallel_group VARCHAR(100),semantic_key VARCHAR(100) NOT NULL,
 required_authority TEXT NOT NULL,resolved_unit_id BIGINT REFERENCES organization_units(id),resolved_position_id BIGINT REFERENCES organization_positions(id),
 structural_holder_id INTEGER REFERENCES users(id),acting_approver_id INTEGER REFERENCES users(id),delegation_id BIGINT REFERENCES approval_authority_delegations(id),
 resolution_type VARCHAR(30) NOT NULL,resolution_reason TEXT,generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),row_version INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT approval_snapshot_step_sequence_ck CHECK(sequence>0),CONSTRAINT approval_snapshot_step_level_ck CHECK(approval_level>0),
 CONSTRAINT approval_snapshot_step_resolution_ck CHECK(resolution_type IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','DEDUPLICATED','DUPLICATE_PRINCIPAL')),
 CONSTRAINT approval_snapshot_step_row_version_ck CHECK(row_version=1),CONSTRAINT approval_snapshot_step_sequence_uq UNIQUE(snapshot_id,sequence)
);
CREATE INDEX approval_route_snapshot_steps_approver_idx ON approval_route_snapshot_steps(snapshot_id,acting_approver_id);

CREATE FUNCTION approval_route_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'APPROVAL_ROUTE_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000'; END $fn$;
CREATE FUNCTION approval_route_snapshot_validate() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE prior approval_route_snapshots%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM requests WHERE id=NEW.request_id AND institute_id=NEW.institute_id) THEN RAISE EXCEPTION 'SNAPSHOT_REQUEST_INSTITUTE_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM approval_policy_versions v JOIN approval_policies p ON p.id=v.approval_policy_id WHERE v.id=NEW.policy_version_id AND p.id=NEW.policy_id AND p.institute_id=NEW.institute_id) THEN RAISE EXCEPTION 'SNAPSHOT_POLICY_INSTITUTE_MISMATCH'; END IF;
 IF NEW.generation_number=1 AND NEW.supersedes_snapshot_id IS NOT NULL THEN RAISE EXCEPTION 'SNAPSHOT_FIRST_GENERATION_CANNOT_SUPERSEDE'; END IF;
 IF NEW.generation_number>1 THEN
   IF NEW.supersedes_snapshot_id IS NULL THEN RAISE EXCEPTION 'SNAPSHOT_SUPERSEDES_REQUIRED'; END IF;
   SELECT * INTO prior FROM approval_route_snapshots WHERE id=NEW.supersedes_snapshot_id;
   IF NOT FOUND OR prior.request_id<>NEW.request_id OR prior.institute_id<>NEW.institute_id OR prior.generation_number<>NEW.generation_number-1 THEN RAISE EXCEPTION 'SNAPSHOT_SUPERSEDES_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER approval_route_snapshots_validate_trg BEFORE INSERT ON approval_route_snapshots FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_validate();
CREATE TRIGGER approval_route_snapshots_immutable_trg BEFORE UPDATE OR DELETE ON approval_route_snapshots FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_guard();
CREATE TRIGGER approval_route_snapshot_steps_immutable_trg BEFORE UPDATE OR DELETE ON approval_route_snapshot_steps FOR EACH ROW EXECUTE FUNCTION approval_route_snapshot_guard();

INSERT INTO permissions(code,name,description) VALUES
 ('approval-delegation.view','View approval delegations','View institute-scoped approval-authority delegations'),
 ('approval-delegation.manage','Manage approval delegations','Create and revoke governed approval-authority delegations'),
 ('approval-policy.simulate','Simulate approval policies','Run side-effect-free institute-scoped policy simulations')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;
ALTER TABLE approval_policy_shadow_steps DROP CONSTRAINT IF EXISTS approval_policy_shadow_steps_resolution_status_check;
ALTER TABLE approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_resolution_status_check CHECK(resolution_status IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED','DUPLICATE_PRINCIPAL'));
END $install$;
COMMIT;