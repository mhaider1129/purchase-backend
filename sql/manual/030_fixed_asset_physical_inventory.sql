-- 030: Fixed Asset physical inventory and reconciliation foundation.
-- MANUAL/PENDING. Run after SQL 017-029; never executed by application startup.
BEGIN;
DO $migration$
DECLARE
  expected text[] := ARRAY['asset_inventory_number_allocators','asset_inventory_sessions','asset_inventory_expected_assets','asset_inventory_observations','asset_inventory_discoveries','asset_inventory_findings','asset_inventory_resolutions'];
  present integer;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['institutes','users','departments','sections','asset_locations','assets','asset_tags','asset_movements','custody_records','rfid_read_events','rfid_business_events','permissions']) n WHERE to_regclass('public.'||n) IS NULL)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assets' AND column_name='row_version' AND data_type='integer') THEN
    RAISE EXCEPTION 'SQL_030_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;
  SELECT count(*) INTO present FROM unnest(expected) n WHERE to_regclass('public.'||n) IS NOT NULL;
  IF present NOT IN (0,array_length(expected,1)) THEN
    RAISE EXCEPTION 'SQL_030_PARTIAL_OR_DRIFTED_SCHEMA' USING DETAIL=format('found %s of %s owned tables',present,array_length(expected,1));
  END IF;
  IF present=array_length(expected,1) THEN
    -- A rerun is accepted only when the complete owned contract is compatible.
    -- Column checks deliberately include type and material nullability rather
    -- than treating table-name presence as proof of a successful deployment.
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('asset_inventory_sessions','id','bigint','NO'),('asset_inventory_sessions','institute_id','integer','NO'),('asset_inventory_sessions','session_number','character varying','NO'),('asset_inventory_sessions','scope_type','character varying','NO'),('asset_inventory_sessions','status','character varying','NO'),('asset_inventory_sessions','row_version','integer','NO'),
        ('asset_inventory_expected_assets','session_id','bigint','NO'),('asset_inventory_expected_assets','asset_id','bigint','NO'),('asset_inventory_expected_assets','snapshot_at','timestamp with time zone','NO'),
        ('asset_inventory_observations','session_id','bigint','NO'),('asset_inventory_observations','asset_id','bigint','YES'),('asset_inventory_observations','observation_method','character varying','NO'),('asset_inventory_observations','raw_evidence','jsonb','NO'),('asset_inventory_observations','dedupe_key','text','NO'),
        ('asset_inventory_discoveries','session_id','bigint','NO'),('asset_inventory_discoveries','registered_asset_id','bigint','YES'),
        ('asset_inventory_findings','session_id','bigint','NO'),('asset_inventory_findings','finding_type','character varying','NO'),('asset_inventory_findings','context','jsonb','NO'),('asset_inventory_findings','status','character varying','NO'),
        ('asset_inventory_resolutions','finding_id','bigint','NO'),('asset_inventory_resolutions','resolution_notes','text','NO')
      ) required(table_name,column_name,data_type,is_nullable)
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=required.table_name AND c.column_name=required.column_name AND c.data_type=required.data_type AND c.is_nullable=required.is_nullable)
    ) OR EXISTS (
      SELECT 1 FROM (VALUES
        ('asset_inventory_sessions','asset_inventory_sessions_institute_id_fkey'),('asset_inventory_expected_assets','asset_inventory_expected_assets_session_id_fkey'),('asset_inventory_expected_assets','asset_inventory_expected_assets_asset_id_fkey'),('asset_inventory_observations','asset_inventory_observations_session_id_fkey'),('asset_inventory_observations','asset_inventory_observations_asset_id_fkey'),('asset_inventory_findings','asset_inventory_findings_session_id_fkey'),('asset_inventory_resolutions','asset_inventory_resolutions_finding_id_fkey')
      ) required(table_name,constraint_name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=('public.'||required.table_name)::regclass AND c.conname=required.constraint_name AND c.contype='f')
    ) OR EXISTS (
      SELECT 1 FROM (VALUES
        ('asset_inventory_sessions','asset_inventory_sessions_institute_id_session_number_key'),('asset_inventory_expected_assets','asset_inventory_expected_assets_session_id_asset_id_key'),('asset_inventory_observations','asset_inventory_observations_session_id_dedupe_key_key')
      ) required(table_name,constraint_name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=('public.'||required.table_name)::regclass AND c.conname=required.constraint_name AND c.contype='u')
    ) OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_findings'::regclass AND conname='asset_inventory_findings_type_ck' AND contype='c')
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.asset_inventory_sessions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%scope_type%')
       OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='asset_inventory_one_open_finding_uq' AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%COALESCE(asset_id, 0%' AND indexdef LIKE '%status%OPEN%ACKNOWLEDGED%')
       OR to_regprocedure('public.next_asset_inventory_number(integer)') IS NULL
       OR (SELECT prorettype::regtype::text FROM pg_proc WHERE oid=to_regprocedure('public.next_asset_inventory_number(integer)')) <> 'text'
       OR to_regprocedure('public.prevent_inventory_snapshot_mutation()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.asset_inventory_expected_assets'::regclass AND tgname='asset_inventory_expected_immutable' AND NOT tgisinternal AND (tgtype & 16)=16 AND (tgtype & 8)=8)
       OR EXISTS (SELECT 1 FROM (VALUES ('fixed-assets.inventory.view'),('fixed-assets.inventory.create'),('fixed-assets.inventory.count'),('fixed-assets.inventory.review'),('fixed-assets.inventory.resolve')) required(code) WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code=required.code)) THEN
      RAISE EXCEPTION 'SQL_030_PARTIAL_OR_DRIFTED_SCHEMA';
    END IF;
    RAISE NOTICE 'SQL_030_ALREADY_APPLIED_COMPATIBLE'; RETURN;
  END IF;

  CREATE TABLE asset_inventory_number_allocators(institute_id integer PRIMARY KEY REFERENCES institutes(id) ON DELETE RESTRICT,next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0),prefix varchar(20) NOT NULL DEFAULT 'WICI-FAI');
  CREATE FUNCTION next_asset_inventory_number(p_institute_id integer) RETURNS text LANGUAGE plpgsql AS $fn$ DECLARE n bigint;p text; BEGIN INSERT INTO asset_inventory_number_allocators(institute_id,next_value) VALUES(p_institute_id,2) ON CONFLICT(institute_id) DO UPDATE SET next_value=asset_inventory_number_allocators.next_value+1 RETURNING next_value-1,prefix INTO n,p; RETURN p||'-'||extract(year from current_date)::integer||'-'||lpad(n::text,6,'0'); END $fn$;
  CREATE TABLE asset_inventory_sessions(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),session_number varchar(80) NOT NULL,name varchar(200) NOT NULL,description text,
    scope_type varchar(30) NOT NULL CHECK(scope_type IN('LOCATION','DEPARTMENT','FULL_INSTITUTE')),scope_location_id bigint REFERENCES asset_locations(id),scope_department_id integer REFERENCES departments(id),include_descendants boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','OPEN','COUNTING','REVIEW','COMPLETED','CANCELLED')),started_at timestamptz,started_by integer REFERENCES users(id),counting_started_at timestamptz,review_started_at timestamptz,completed_at timestamptz,completed_by integer REFERENCES users(id),cancelled_at timestamptz,cancelled_by integer REFERENCES users(id),cancellation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),updated_by integer NOT NULL REFERENCES users(id),row_version integer NOT NULL DEFAULT 1,
    UNIQUE(institute_id,session_number),CHECK((scope_type='LOCATION' AND scope_location_id IS NOT NULL AND scope_department_id IS NULL) OR (scope_type='DEPARTMENT' AND scope_department_id IS NOT NULL AND scope_location_id IS NULL) OR (scope_type='FULL_INSTITUTE' AND scope_location_id IS NULL AND scope_department_id IS NULL)));
  CREATE TABLE asset_inventory_expected_assets(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),session_id bigint NOT NULL REFERENCES asset_inventory_sessions(id) ON DELETE RESTRICT,asset_id bigint NOT NULL REFERENCES assets(id),asset_number_snapshot varchar(60) NOT NULL,description_snapshot text NOT NULL,category_id bigint,category_name_snapshot text,expected_location_id bigint REFERENCES asset_locations(id),expected_location_name_snapshot text,expected_department_id integer REFERENCES departments(id),expected_department_name_snapshot text,expected_section_id integer REFERENCES sections(id),expected_section_name_snapshot text,expected_custodian_user_id integer REFERENCES users(id),expected_custodian_name_snapshot text,operational_status_snapshot varchar(30) NOT NULL,condition_snapshot varchar(30) NOT NULL,expected_rfid_epc_snapshot varchar(128),snapshot_at timestamptz NOT NULL,UNIQUE(session_id,asset_id));
  CREATE TABLE asset_inventory_observations(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),session_id bigint NOT NULL REFERENCES asset_inventory_sessions(id),asset_id bigint REFERENCES assets(id),observed_identifier text NOT NULL,observation_method varchar(20) NOT NULL CHECK(observation_method IN('MANUAL','QR','RFID')),observed_location_id bigint REFERENCES asset_locations(id),observed_department_id integer REFERENCES departments(id),observed_custodian_user_id integer REFERENCES users(id),observed_at timestamptz NOT NULL,observed_by integer NOT NULL REFERENCES users(id),rfid_read_event_id bigint REFERENCES rfid_read_events(id),rfid_business_event_id bigint REFERENCES rfid_business_events(id),notes text,condition_observed varchar(30),operational_status_observed varchar(30),raw_evidence jsonb NOT NULL DEFAULT '{}',dedupe_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(session_id,dedupe_key));
  CREATE TABLE asset_inventory_discoveries(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),session_id bigint NOT NULL REFERENCES asset_inventory_sessions(id),description text NOT NULL,manufacturer text,model text,serial_number text,observed_location_id bigint REFERENCES asset_locations(id),department_id integer REFERENCES departments(id),condition_observed varchar(30),notes text,evidence jsonb NOT NULL DEFAULT '{}',discovered_by integer NOT NULL REFERENCES users(id),discovered_at timestamptz NOT NULL DEFAULT now(),registered_asset_id bigint REFERENCES assets(id),registered_at timestamptz,UNIQUE(institute_id,id));
  CREATE TABLE asset_inventory_findings(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),session_id bigint NOT NULL REFERENCES asset_inventory_sessions(id),expected_asset_id bigint REFERENCES asset_inventory_expected_assets(id),asset_id bigint REFERENCES assets(id),observation_id bigint REFERENCES asset_inventory_observations(id),discovery_id bigint REFERENCES asset_inventory_discoveries(id),finding_type varchar(40) NOT NULL, severity varchar(20) NOT NULL DEFAULT 'MEDIUM' CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')),status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),context jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),acknowledged_at timestamptz,acknowledged_by integer REFERENCES users(id),resolved_at timestamptz,resolved_by integer REFERENCES users(id),resolution_code varchar(60),resolution_notes text,CONSTRAINT asset_inventory_findings_type_ck CHECK(finding_type IN('VERIFIED','MISSING','UNEXPECTED','WRONG_LOCATION','RESPONSIBILITY_MISMATCH','CUSTODY_MISMATCH','IDENTIFICATION_CONFLICT','CONDITION_MISMATCH','STATUS_MISMATCH','REQUIRES_INVESTIGATION','UNREGISTERED')),UNIQUE(session_id,finding_type,asset_id,observation_id,discovery_id));
  CREATE TABLE asset_inventory_resolutions(id bigserial PRIMARY KEY,institute_id integer NOT NULL REFERENCES institutes(id),finding_id bigint NOT NULL REFERENCES asset_inventory_findings(id),from_status varchar(20) NOT NULL,to_status varchar(20) NOT NULL CHECK(to_status IN('ACKNOWLEDGED','RESOLVED','DISMISSED')),resolution_code varchar(60),resolution_notes text NOT NULL,business_object_type varchar(50),business_object_id bigint,created_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id));

  CREATE INDEX asset_inventory_sessions_scope_idx ON asset_inventory_sessions(institute_id,status,created_at DESC);
  CREATE INDEX asset_inventory_expected_session_idx ON asset_inventory_expected_assets(institute_id,session_id);
  CREATE INDEX asset_inventory_observations_session_asset_idx ON asset_inventory_observations(institute_id,session_id,asset_id,observed_at DESC);
  CREATE INDEX asset_inventory_findings_filter_idx ON asset_inventory_findings(institute_id,session_id,status,finding_type);
  CREATE UNIQUE INDEX asset_inventory_one_open_finding_uq ON asset_inventory_findings(session_id,finding_type,COALESCE(asset_id,0),COALESCE(discovery_id,0)) WHERE status IN('OPEN','ACKNOWLEDGED');
  CREATE FUNCTION prevent_inventory_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'INVENTORY_EXPECTED_SNAPSHOT_IMMUTABLE'; END $fn$;
  CREATE TRIGGER asset_inventory_expected_immutable BEFORE UPDATE OR DELETE ON asset_inventory_expected_assets FOR EACH ROW EXECUTE FUNCTION prevent_inventory_snapshot_mutation();
  INSERT INTO permissions(code,name,description) VALUES
    ('fixed-assets.inventory.view','Fixed assets: view physical inventory','View institute-scoped physical inventory and reconciliation'),
    ('fixed-assets.inventory.create','Fixed assets: create physical inventory','Create institute-scoped inventory sessions'),
    ('fixed-assets.inventory.count','Fixed assets: count physical inventory','Start counts and record physical observations'),
    ('fixed-assets.inventory.review','Fixed assets: review reconciliation','Close counting and review findings'),
    ('fixed-assets.inventory.resolve','Fixed assets: resolve reconciliation','Acknowledge, dismiss, and resolve findings') ON CONFLICT(code) DO NOTHING;
END $migration$;
COMMIT;