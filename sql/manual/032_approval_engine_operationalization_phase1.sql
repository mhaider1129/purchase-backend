-- 032: Approval Engine 2.0 operationalization phase 1
-- MANUAL/PENDING — NOT EXECUTED. Apply to Development first; promote this exact file only after validation.
BEGIN;
DO $$
DECLARE object_count integer; compatible boolean;
BEGIN
  IF to_regclass('public.organization_units') IS NULL OR to_regclass('public.organization_positions') IS NULL
     OR to_regclass('public.approval_policy_versions') IS NULL OR to_regclass('public.approval_policy_rule_steps') IS NULL
     OR to_regclass('public.approvals') IS NULL OR to_regclass('public.requests') IS NULL THEN
    RAISE EXCEPTION 'SQL_032_MISSING_PREREQUISITE: manually apply governed migrations 014-016 before 032';
  END IF;
  SELECT count(*) INTO object_count FROM (VALUES
    ('approval_authority_delegations'),('approval_route_snapshots'),('approval_route_snapshot_steps')) x(name)
    WHERE to_regclass('public.'||name) IS NOT NULL;
  IF object_count NOT IN (0,3) THEN RAISE EXCEPTION 'SQL_032_PARTIAL_OR_DRIFTED'; END IF;
  IF object_count=3 THEN
    compatible :=
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='approval_authority_delegations' AND column_name='institute_id' AND is_nullable='NO') AND
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='approval_authority_delegations' AND column_name='scope' AND is_nullable='NO') AND
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='approval_route_snapshots' AND column_name='facts_snapshot' AND data_type='jsonb' AND is_nullable='NO') AND
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='approval_route_snapshot_steps' AND column_name='semantic_key' AND is_nullable='NO') AND
      to_regclass('public.approval_authority_delegations_effective_idx') IS NOT NULL AND
      to_regclass('public.approval_route_snapshots_request_idx') IS NOT NULL;
    IF NOT compatible THEN RAISE EXCEPTION 'SQL_032_PARTIAL_OR_DRIFTED'; END IF;
    RAISE NOTICE 'SQL_032_COMPLETE_COMPATIBLE'; RETURN;
  END IF;
  PERFORM set_config('purchase_tracker.sql_032_install','true',true);
END $$;

DO $install$
BEGIN
IF current_setting('purchase_tracker.sql_032_install',true) IS DISTINCT FROM 'true' THEN RETURN; END IF;
CREATE TABLE approval_authority_delegations(
 id BIGSERIAL PRIMARY KEY,institute_id INTEGER NOT NULL REFERENCES institutes(id),organization_position_id BIGINT REFERENCES organization_positions(id),
 delegator_user_id INTEGER REFERENCES users(id),delegate_user_id INTEGER NOT NULL REFERENCES users(id),effective_from TIMESTAMPTZ NOT NULL,effective_to TIMESTAMPTZ NOT NULL,
 scope VARCHAR(80) NOT NULL,reason TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REVOKED')),
 created_by INTEGER NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),revoked_by INTEGER REFERENCES users(id),revoked_at TIMESTAMPTZ,
 revocation_reason TEXT,row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 CHECK(organization_position_id IS NOT NULL OR delegator_user_id IS NOT NULL),CHECK(delegate_user_id IS DISTINCT FROM delegator_user_id),CHECK(effective_to>=effective_from),
 CHECK((status='ACTIVE' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL) OR (status='REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL))
);
CREATE INDEX approval_authority_delegations_effective_idx ON approval_authority_delegations(institute_id,scope,effective_from,effective_to) WHERE status='ACTIVE';
CREATE INDEX approval_authority_delegations_position_idx ON approval_authority_delegations(organization_position_id) WHERE status='ACTIVE';
CREATE INDEX approval_authority_delegations_delegator_idx ON approval_authority_delegations(delegator_user_id) WHERE status='ACTIVE';

CREATE TABLE approval_route_snapshots(
 id BIGSERIAL PRIMARY KEY,institute_id INTEGER NOT NULL REFERENCES institutes(id),request_id INTEGER NOT NULL REFERENCES requests(id),policy_id BIGINT NOT NULL REFERENCES approval_policies(id),
 policy_version_id BIGINT NOT NULL REFERENCES approval_policy_versions(id),facts_snapshot JSONB NOT NULL,route_generation_context JSONB NOT NULL DEFAULT '{}'::jsonb,
 generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),generated_by INTEGER REFERENCES users(id),UNIQUE(request_id,policy_version_id)
);
CREATE INDEX approval_route_snapshots_request_idx ON approval_route_snapshots(institute_id,request_id,generated_at DESC);
CREATE TABLE approval_route_snapshot_steps(
 id BIGSERIAL PRIMARY KEY,snapshot_id BIGINT NOT NULL REFERENCES approval_route_snapshots(id),policy_rule_id BIGINT REFERENCES approval_policy_rules(id),policy_step_id BIGINT REFERENCES approval_policy_rule_steps(id),
 sequence INTEGER NOT NULL CHECK(sequence>0),approval_level INTEGER NOT NULL CHECK(approval_level>0),parallel_group VARCHAR(100),semantic_key VARCHAR(100) NOT NULL,
 required_authority TEXT NOT NULL,resolved_unit_id BIGINT REFERENCES organization_units(id),resolved_position_id BIGINT REFERENCES organization_positions(id),
 structural_holder_id INTEGER REFERENCES users(id),acting_approver_id INTEGER REFERENCES users(id),delegation_id BIGINT REFERENCES approval_authority_delegations(id),
 resolution_type VARCHAR(30) NOT NULL CHECK(resolution_type IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','DEDUPLICATED','DUPLICATE_PRINCIPAL')),
 resolution_reason TEXT,generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(snapshot_id,sequence)
);
INSERT INTO permissions(code,name,description) VALUES
 ('approval-delegation.view','View approval delegations','View institute-scoped approval-authority delegations'),
 ('approval-delegation.manage','Manage approval delegations','Create and revoke governed approval-authority delegations'),
 ('approval-policy.simulate','Simulate approval policies','Run side-effect-free institute-scoped policy simulations')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;
ALTER TABLE approval_policy_shadow_steps DROP CONSTRAINT IF EXISTS approval_policy_shadow_steps_resolution_status_check;
ALTER TABLE approval_policy_shadow_steps ADD CONSTRAINT approval_policy_shadow_steps_resolution_status_check CHECK(resolution_status IN('RESOLVED','DELEGATED','UNRESOLVED','AMBIGUOUS','SKIPPED','DEDUPLICATED','DUPLICATE_PRINCIPAL'));
END $install$;
COMMIT;