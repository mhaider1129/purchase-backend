-- PENDING MANUAL MIGRATION 012. Review and execute only through the governed migration runbook.
-- Depends on 010 procurement_cases and existing users/departments/institutes. It does not alter 008-011.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.procurement_cases') IS NULL THEN RAISE EXCEPTION 'Preflight: procurement_cases is required'; END IF;
  IF to_regclass('public.users') IS NULL THEN RAISE EXCEPTION 'Preflight: users is required'; END IF;
END $$;

CREATE TABLE procurement_priority_profiles (
  id BIGSERIAL PRIMARY KEY, procurement_case_id BIGINT NOT NULL UNIQUE REFERENCES procurement_cases(id),
  institute_id BIGINT NOT NULL, department_id BIGINT NOT NULL, coverage_status TEXT NOT NULL DEFAULT 'NEEDS_ASSESSMENT'
    CHECK (coverage_status IN ('PARTIAL','NEEDS_ASSESSMENT','COMPLETE')),
  impact_level TEXT, impact_reason TEXT, scm_assessment SMALLINT CHECK (scm_assessment BETWEEN 0 AND 100),
  scm_reason TEXT, scm_assessed_by BIGINT REFERENCES users(id), scm_assessed_at TIMESTAMPTZ,
  service_risk_level TEXT, service_risk_override_reason TEXT, deadline_at TIMESTAMPTZ,
  deadline_type TEXT, deadline_consequence TEXT, deadline_evidence_reference TEXT,
  dependency_level TEXT, dependency_reason TEXT, regulatory_level TEXT, regulatory_reason TEXT,
  approved_initiative_id BIGINT, supply_chain_owned_at TIMESTAMPTZ,
  system_score NUMERIC(5,2), system_tier TEXT CHECK (system_tier IN ('P0','P1','P2','P3','P4')),
  model_version TEXT NOT NULL DEFAULT 'IPPS-1.0', system_suggested_rank INTEGER,
  institutional_rank INTEGER, institutional_override_reason TEXT, p0_justification TEXT,
  public_title TEXT, public_description TEXT, is_public BOOLEAN NOT NULL DEFAULT false, row_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE department_priority_rankings (
  id BIGSERIAL PRIMARY KEY, procurement_case_id BIGINT NOT NULL REFERENCES procurement_cases(id),
  institute_id BIGINT NOT NULL, department_id BIGINT NOT NULL, department_rank INTEGER NOT NULL CHECK (department_rank > 0),
  department_rank_total INTEGER NOT NULL CHECK (department_rank_total >= department_rank), ranked_by BIGINT NOT NULL REFERENCES users(id),
  ranked_at TIMESTAMPTZ NOT NULL DEFAULT now(), valid_until TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (institute_id, department_id, department_rank, valid_until)
);
CREATE UNIQUE INDEX department_priority_one_current_case ON department_priority_rankings(procurement_case_id) WHERE valid_until IS NULL;

CREATE TABLE procurement_priority_history (
  id BIGSERIAL PRIMARY KEY, procurement_case_id BIGINT NOT NULL REFERENCES procurement_cases(id), score NUMERIC(5,2) NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('P0','P1','P2','P3','P4')), factor_breakdown JSONB NOT NULL,
  model_version TEXT NOT NULL, trigger TEXT NOT NULL, trigger_reason TEXT, institutional_rank INTEGER,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(), calculated_by BIGINT REFERENCES users(id), calculated_by_system BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE procurement_priority_groups (
  id BIGSERIAL PRIMARY KEY, institute_id BIGINT NOT NULL, name TEXT NOT NULL, public_title TEXT NOT NULL, public_description TEXT,
  tier_override TEXT CHECK (tier_override IN ('P0','P1','P2','P3','P4')), tier_override_reason TEXT,
  institutional_rank INTEGER, institutional_rank_reason TEXT, is_public BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_by BIGINT NOT NULL REFERENCES users(id), updated_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement_priority_group_members (
  group_id BIGINT NOT NULL REFERENCES procurement_priority_groups(id), procurement_case_id BIGINT NOT NULL REFERENCES procurement_cases(id),
  added_by BIGINT NOT NULL REFERENCES users(id), added_at TIMESTAMPTZ NOT NULL DEFAULT now(), removed_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, procurement_case_id)
);

CREATE INDEX priority_profiles_public_queue ON procurement_priority_profiles(institute_id, institutional_rank) WHERE is_public;
CREATE INDEX priority_history_case_time ON procurement_priority_history(procurement_case_id, calculated_at DESC);

INSERT INTO permissions(code, name, description) VALUES
 ('procurement-priority.view-public','View public procurement priority','Read the safe institutional queue'),
 ('procurement-priority.rank-department','Rank department procurement priority','Manage the actor department queue'),
 ('procurement-priority.manage','Manage procurement priority','Assess factors and manage the institutional queue'),
 ('procurement-priority.override','Override procurement priority rank','Apply reasoned institutional overrides'),
 ('procurement-priority.manage-groups','Manage procurement priority groups','Manage governed public groups')
ON CONFLICT (code) DO NOTHING;

-- Existing cases are intentionally not backfilled with HOD ranks or SCM assessments.
-- Deployment tooling may create NEEDS_ASSESSMENT profiles only; reliable supply-chain-owned timestamps may drive aging later.