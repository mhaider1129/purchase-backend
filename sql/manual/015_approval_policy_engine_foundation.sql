-- 015: Approval Policy Engine 2.0 foundation. MANUAL/PENDING; depends on governed migration 014.
BEGIN;
DO $$ DECLARE present_count integer; BEGIN
  IF to_regclass('public.organization_units') IS NULL OR to_regclass('public.organization_positions') IS NULL THEN RAISE EXCEPTION 'SQL_015_REQUIRES_MANUALLY_APPLIED_SQL_014'; END IF;
  SELECT count(*) INTO present_count FROM (VALUES ('approval_policies'),('approval_policy_versions'),('approval_policy_rules'),('approval_policy_rule_conditions'),('approval_policy_rule_steps'),('approval_policy_shadow_runs'),('approval_policy_shadow_steps'),('approval_policy_shadow_differences')) t(name) WHERE to_regclass('public.'||name) IS NOT NULL;
  IF present_count NOT IN (0,8) THEN RAISE EXCEPTION 'SQL_015_PARTIAL_OR_DRIFTED_SCHEMA'; END IF;
  IF present_count=8 THEN
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='approval_policy_rule_steps' AND column_name='semantic_key' AND is_nullable='NO')
       OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='approval_policy_shadow_runs' AND column_name='facts_snapshot' AND data_type='jsonb')
       OR to_regclass('public.approval_policy_versions_number_uq') IS NULL
       OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='approval_policy_rules' AND indexdef LIKE 'CREATE UNIQUE INDEX %' AND regexp_replace(indexdef,'[[:space:]]','','g') LIKE '%(policy_version_id,priority)%')
       THEN RAISE EXCEPTION 'SQL_015_PARTIAL_OR_DRIFTED_SCHEMA'; END IF;
    PERFORM set_config('purchase_tracker.sql_015_upgrade','true',true);
    RAISE NOTICE 'SQL_015_EXISTING_COMPATIBLE_SCHEMA_WILL_BE_STABILIZED';
  ELSE PERFORM set_config('purchase_tracker.sql_015_install','true',true); END IF;
END $$;
DO $install$ BEGIN IF current_setting('purchase_tracker.sql_015_install',true) IS DISTINCT FROM 'true' THEN RETURN; END IF;
CREATE TABLE approval_policies(id BIGSERIAL PRIMARY KEY,institute_id INTEGER NOT NULL REFERENCES institutes(id),code VARCHAR(100) NOT NULL,name VARCHAR(255) NOT NULL,description TEXT,request_scope VARCHAR(50) NOT NULL DEFAULT 'PURCHASE_REQUEST',is_active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_by INTEGER REFERENCES users(id),updated_by INTEGER REFERENCES users(id));
CREATE UNIQUE INDEX approval_policies_institute_code_uq ON approval_policies(institute_id,lower(code));
CREATE TABLE approval_policy_versions(id BIGSERIAL PRIMARY KEY,approval_policy_id BIGINT NOT NULL REFERENCES approval_policies(id),version_number INTEGER NOT NULL CHECK(version_number>0),status VARCHAR(20) NOT NULL CHECK(status IN('DRAFT','VALIDATED','SHADOW','ACTIVE','RETIRED')),effective_from TIMESTAMPTZ,effective_to TIMESTAMPTZ,change_reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_by INTEGER REFERENCES users(id),validated_at TIMESTAMPTZ,validated_by INTEGER REFERENCES users(id),activated_at TIMESTAMPTZ,activated_by INTEGER REFERENCES users(id),CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from));
CREATE UNIQUE INDEX approval_policy_versions_number_uq ON approval_policy_versions(approval_policy_id,version_number);
CREATE TABLE approval_policy_rules(id BIGSERIAL PRIMARY KEY,policy_version_id BIGINT NOT NULL REFERENCES approval_policy_versions(id) ON DELETE CASCADE,rule_code VARCHAR(100) NOT NULL,name VARCHAR(255) NOT NULL,description TEXT,priority INTEGER NOT NULL CHECK(priority>0),is_active BOOLEAN NOT NULL DEFAULT true,stop_processing BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(policy_version_id,rule_code));
CREATE UNIQUE INDEX approval_policy_rules_priority_uq ON approval_policy_rules(policy_version_id,priority);
CREATE TABLE approval_policy_rule_conditions(id BIGSERIAL PRIMARY KEY,policy_rule_id BIGINT NOT NULL REFERENCES approval_policy_rules(id) ON DELETE CASCADE,condition_group INTEGER NOT NULL DEFAULT 1 CHECK(condition_group>0),condition_type VARCHAR(60) NOT NULL CHECK(condition_type IN('REQUEST_TYPE_EQUALS','DEPARTMENT_EQUALS','SECTION_EQUALS','DEPARTMENT_CLASSIFICATION_EQUALS','ORGANIZATION_ANCESTOR_EQUALS','AMOUNT_GTE','AMOUNT_LT','IS_STOCK_REQUEST','IS_NON_STOCK_REQUEST','IS_MAINTENANCE_REQUEST','IS_MEDICAL_DEVICE_REQUEST','IS_MEDICAL_REQUEST','WAREHOUSE_REQUIRED')),condition_value TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE approval_policy_rule_steps(id BIGSERIAL PRIMARY KEY,policy_rule_id BIGINT NOT NULL REFERENCES approval_policy_rules(id) ON DELETE CASCADE,step_order INTEGER NOT NULL CHECK(step_order>0),approval_level INTEGER NOT NULL CHECK(approval_level>0),resolver_type VARCHAR(60) NOT NULL CHECK(resolver_type IN('REQUESTER','DEPARTMENT_HEAD','SECTION_HEAD','EXECUTIVE_OWNER','POSITION','CAPABILITY_HOLDER','FIXED_USER','FIXED_AUTHORITY','SUPPLY_CHAIN_AUTHORITY','COO_AUTHORITY','CEO_AUTHORITY','CFO_AUTHORITY','WAREHOUSE_AUTHORITY','MEDICAL_DEVICES_AUTHORITY')),resolver_reference TEXT,required BOOLEAN NOT NULL DEFAULT true,parallel_group VARCHAR(100),semantic_key VARCHAR(100) NOT NULL,display_name VARCHAR(255) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(policy_rule_id,step_order,semantic_key,resolver_type));
CREATE TABLE approval_policy_shadow_runs(id BIGSERIAL PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES requests(id),policy_version_id BIGINT NOT NULL REFERENCES approval_policy_versions(id),existing_route_version TEXT,run_status VARCHAR(20) NOT NULL CHECK(run_status IN('MATCH','PARTIAL_MATCH','DIFFERENT','UNRESOLVED','ERROR')),generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),generated_by INTEGER REFERENCES users(id),facts_snapshot JSONB NOT NULL,summary JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX approval_policy_shadow_runs_lookup_idx ON approval_policy_shadow_runs(policy_version_id,generated_at DESC);
CREATE INDEX approval_policy_shadow_runs_request_idx ON approval_policy_shadow_runs(request_id,generated_at DESC);
CREATE TABLE approval_policy_shadow_steps(id BIGSERIAL PRIMARY KEY,shadow_run_id BIGINT NOT NULL REFERENCES approval_policy_shadow_runs(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,approval_level INTEGER NOT NULL,parallel_group VARCHAR(100),semantic_key VARCHAR(100) NOT NULL,resolver_type VARCHAR(60) NOT NULL,resolver_reference TEXT,resolved_user_id INTEGER REFERENCES users(id),resolved_user_name VARCHAR(255),resolved_unit_id BIGINT REFERENCES organization_units(id),resolution_status VARCHAR(20) NOT NULL CHECK(resolution_status IN('RESOLVED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED')),resolution_reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(shadow_run_id,sequence));
CREATE TABLE approval_policy_shadow_differences(id BIGSERIAL PRIMARY KEY,shadow_run_id BIGINT NOT NULL REFERENCES approval_policy_shadow_runs(id) ON DELETE CASCADE,difference_type VARCHAR(40) NOT NULL CHECK(difference_type IN('MISSING_IN_SHADOW','ADDED_BY_SHADOW','DIFFERENT_USER','DIFFERENT_LEVEL','DIFFERENT_ORDER','AMBIGUOUS_RESOLUTION','UNRESOLVED_RESOLUTION','DUPLICATE_PRINCIPAL','MATCH')),current_step_sequence INTEGER,shadow_step_sequence INTEGER,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX approval_policy_shadow_differences_type_idx ON approval_policy_shadow_differences(shadow_run_id,difference_type);
END $install$;
-- Stabilize a compatible schema created by the earlier pending 015 draft.  These
-- additions are deliberately gated by the strict eight-table preflight above;
-- an incomplete or structurally drifted schema still fails closed.
DO $upgrade$ BEGIN
  IF current_setting('purchase_tracker.sql_015_upgrade',true) IS DISTINCT FROM 'true' THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.approval_policy_rules'::regclass AND contype='c' AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]','','g')='CHECKpriority>0') THEN
    ALTER TABLE approval_policy_rules ADD CONSTRAINT approval_policy_rules_priority_positive_ck CHECK(priority>0);
  END IF;
  IF to_regclass('public.approval_policy_shadow_runs_request_idx') IS NULL THEN
    CREATE INDEX approval_policy_shadow_runs_request_idx ON approval_policy_shadow_runs(request_id,generated_at DESC);
  END IF;
  IF to_regclass('public.approval_policy_shadow_differences_type_idx') IS NULL THEN
    CREATE INDEX approval_policy_shadow_differences_type_idx ON approval_policy_shadow_differences(shadow_run_id,difference_type);
  END IF;
END $upgrade$;
COMMIT;