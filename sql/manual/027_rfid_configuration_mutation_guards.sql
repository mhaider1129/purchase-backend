-- 027: Harden deployed SQL 018 guards against RFID reader/antenna scope mutations.
-- FORWARD-ONLY. Run manually after 018; never from application startup.
BEGIN;

DO $migration$
DECLARE
  required_tables constant text[] := ARRAY[
    'asset_number_allocators','asset_categories','asset_locations','assets',
    'asset_movements','asset_tags','rfid_readers','rfid_antennas','rfid_portals',
    'rfid_portal_antennas','rfid_integration_clients','rfid_read_events',
    'rfid_business_events','asset_exceptions'
  ];
  function_count integer;
  trigger_count integer;
  compatible boolean;
  bad record;
BEGIN
  -- Strict 017 preflight: both the relations and every column/type used below are contractual.
  IF EXISTS (
    SELECT 1 FROM unnest(required_tables) AS required(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=required.name AND c.relkind IN ('r','p')
    )
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('rfid_readers','id','bigint'), ('rfid_readers','institute_id','integer'),
      ('rfid_antennas','id','bigint'), ('rfid_antennas','institute_id','integer'),
      ('rfid_antennas','reader_id','bigint'),
      ('rfid_portals','id','bigint'), ('rfid_portals','institute_id','integer'),
      ('rfid_portals','enabled','boolean'),
      ('rfid_portal_antennas','portal_id','bigint'),
      ('rfid_portal_antennas','antenna_id','bigint')
    ) AS expected(table_name,column_name,data_type)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name
        AND c.column_name=expected.column_name AND c.data_type=expected.data_type
        AND c.is_nullable='NO'
    )
  ) THEN
    RAISE EXCEPTION 'SQL_027_DEPENDENCY_MISSING_OR_INCOMPATIBLE';
  END IF;

  SELECT count(*) INTO function_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN (
      'enforce_rfid_portal_antenna_scope','enforce_rfid_portal_enable_scope',
      'enforce_rfid_antenna_scope_update','enforce_rfid_reader_scope_update'
    );
  SELECT count(*) INTO trigger_count
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
    AND t.tgname IN (
      'rfid_portal_antenna_scope_guard','rfid_portal_enable_scope_guard',
      'rfid_antenna_scope_update_guard','rfid_reader_scope_update_guard'
    );

  -- A complete state is deliberately checked structurally and semantically. The embedded
  -- contract tokens make body replacement detectable without depending on pretty-printing.
  SELECT function_count=4 AND trigger_count=4
    AND (SELECT count(*)=4 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public'
           AND p.proname IN (
             'enforce_rfid_portal_antenna_scope','enforce_rfid_portal_enable_scope',
             'enforce_rfid_antenna_scope_update','enforce_rfid_reader_scope_update'
           )
           AND p.prorettype='trigger'::regtype AND p.prosecdef=false
           AND p.provolatile='v' AND p.pronargs=0
           AND p.prosrc LIKE '%SQL_027_FUNCTION_CONTRACT_V1%'
           AND p.prosrc LIKE '%pg_advisory_xact_lock%')
    AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.rfid_portal_antennas'::regclass
        AND t.tgname='rfid_portal_antenna_scope_guard' AND NOT t.tgisinternal
        AND t.tgenabled='O'
        AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF portal_id, antenna_id%'
        AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='enforce_rfid_portal_antenna_scope' AND p.pronargs=0)
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.rfid_portals'::regclass
        AND t.tgname='rfid_portal_enable_scope_guard' AND NOT t.tgisinternal
        AND t.tgenabled='O'
        AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF institute_id, enabled%'
        AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='enforce_rfid_portal_enable_scope' AND p.pronargs=0)
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.rfid_antennas'::regclass
        AND t.tgname='rfid_antenna_scope_update_guard' AND NOT t.tgisinternal
        AND t.tgenabled='O'
        AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF institute_id, reader_id%'
        AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='enforce_rfid_antenna_scope_update' AND p.pronargs=0)
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.rfid_readers'::regclass
        AND t.tgname='rfid_reader_scope_update_guard' AND NOT t.tgisinternal
        AND t.tgenabled='O'
        AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF institute_id%'
        AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='enforce_rfid_reader_scope_update' AND p.pronargs=0)
    ) INTO compatible;

  IF compatible THEN
    RAISE NOTICE 'SQL_027_ALREADY_APPLIED_COMPATIBLE';
    RETURN;
  END IF;
  -- Upgrade only a complete, recognizable SQL 018 installation. This keeps the
  -- deployed 018 file immutable while allowing its two original guards to be hardened.
  IF function_count <> 2 OR trigger_count <> 2
     OR (SELECT count(*) <> 2 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public'
           AND p.proname IN ('enforce_rfid_portal_antenna_scope','enforce_rfid_portal_enable_scope')
           AND p.prorettype='trigger'::regtype AND p.prosecdef=false
           AND p.provolatile='v' AND p.pronargs=0
           AND p.prosrc LIKE '%SQL_018_FUNCTION_CONTRACT_V1%'
           AND p.prosrc LIKE '%pg_advisory_xact_lock%')
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid='public.rfid_portal_antennas'::regclass
         AND t.tgname='rfid_portal_antenna_scope_guard' AND NOT t.tgisinternal
         AND t.tgenabled='O' AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF portal_id, antenna_id%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid='public.rfid_portals'::regclass
         AND t.tgname='rfid_portal_enable_scope_guard' AND NOT t.tgisinternal
         AND t.tgenabled='O' AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF institute_id, enabled%'
     ) THEN
    RAISE EXCEPTION 'SQL_027_REQUIRES_COMPATIBLE_SQL_018';
  END IF;

  -- Validate production-style rows before installing guards. Never repair or delete data here.
  SELECT pa.portal_id,pa.antenna_id INTO bad
  FROM public.rfid_portal_antennas pa
  LEFT JOIN public.rfid_portals p ON p.id=pa.portal_id
  LEFT JOIN public.rfid_antennas a ON a.id=pa.antenna_id
  LEFT JOIN public.rfid_readers r ON r.id=a.reader_id
  WHERE p.id IS NULL OR a.id IS NULL OR r.id IS NULL
     OR p.institute_id<>a.institute_id OR a.institute_id<>r.institute_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SQL_027_INVALID_EXISTING_PORTAL_ANTENNA_SCOPE portal_id=% antenna_id=%',bad.portal_id,bad.antenna_id;
  END IF;
  SELECT pa.antenna_id,min(pa.portal_id) AS portal_id INTO bad
  FROM public.rfid_portal_antennas pa JOIN public.rfid_portals p ON p.id=pa.portal_id
  WHERE p.enabled GROUP BY pa.antenna_id HAVING count(*)>1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'SQL_027_INVALID_EXISTING_ENABLED_PORTAL_CONFLICT antenna_id=%',bad.antenna_id;
  END IF;

  EXECUTE $function$
    CREATE OR REPLACE FUNCTION public.enforce_rfid_portal_antenna_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE p public.rfid_portals%ROWTYPE; a public.rfid_antennas%ROWTYPE; reader_institute integer;
    BEGIN
      -- SQL_027_FUNCTION_CONTRACT_V1
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||NEW.antenna_id::text,0));
      SELECT * INTO p FROM public.rfid_portals WHERE id=NEW.portal_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID portal % does not exist',NEW.portal_id; END IF;
      SELECT * INTO a FROM public.rfid_antennas WHERE id=NEW.antenna_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID antenna % does not exist',NEW.antenna_id; END IF;
      SELECT institute_id INTO reader_institute FROM public.rfid_readers WHERE id=a.reader_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID reader % for antenna % does not exist',a.reader_id,a.id; END IF;
      IF p.institute_id<>a.institute_id THEN RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute'; END IF;
      IF reader_institute<>a.institute_id THEN RAISE EXCEPTION 'RFID antenna and reader must belong to the same institute'; END IF;
      IF p.enabled AND EXISTS (
        SELECT 1 FROM public.rfid_portal_antennas pa JOIN public.rfid_portals other ON other.id=pa.portal_id
        WHERE pa.antenna_id=NEW.antenna_id AND other.enabled AND pa.portal_id<>NEW.portal_id
      ) THEN RAISE EXCEPTION 'RFID antenna % is already mapped to another enabled portal',NEW.antenna_id; END IF;
      RETURN NEW;
    END $body$
  $function$;

  EXECUTE $function$
    CREATE OR REPLACE FUNCTION public.enforce_rfid_portal_enable_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE mapping record;
    BEGIN
      -- SQL_027_FUNCTION_CONTRACT_V1
      IF NEW.institute_id IS DISTINCT FROM OLD.institute_id
         AND EXISTS (SELECT 1 FROM public.rfid_portal_antennas WHERE portal_id=OLD.id) THEN
        RAISE EXCEPTION 'Cannot change institute of a configured RFID portal';
      END IF;
      IF NEW.enabled THEN
        FOR mapping IN
          SELECT pa.antenna_id,NULL::integer AS antenna_institute,NULL::integer AS reader_institute
          FROM public.rfid_portal_antennas pa
          WHERE pa.portal_id=OLD.id ORDER BY pa.antenna_id
        LOOP
          PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||mapping.antenna_id::text,0));
          SELECT a.institute_id,r.institute_id INTO mapping.antenna_institute,mapping.reader_institute
          FROM public.rfid_antennas a JOIN public.rfid_readers r ON r.id=a.reader_id
          WHERE a.id=mapping.antenna_id FOR SHARE OF a,r;
          IF mapping.antenna_institute IS NULL THEN RAISE EXCEPTION 'Mapped RFID antenna % does not exist',mapping.antenna_id; END IF;
          IF mapping.antenna_institute<>NEW.institute_id THEN RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute'; END IF;
          IF mapping.reader_institute IS NULL OR mapping.reader_institute<>NEW.institute_id THEN
            RAISE EXCEPTION 'RFID antenna reader must belong to the same institute';
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.rfid_portal_antennas pa JOIN public.rfid_portals other ON other.id=pa.portal_id
            WHERE pa.antenna_id=mapping.antenna_id AND pa.portal_id<>OLD.id AND other.enabled
          ) THEN RAISE EXCEPTION 'RFID antenna % is already mapped to another enabled portal',mapping.antenna_id; END IF;
        END LOOP;
      END IF;
      RETURN NEW;
    END $body$
  $function$;

  EXECUTE $function$
    CREATE FUNCTION public.enforce_rfid_antenna_scope_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE reader_institute integer; portal_institute integer;
    BEGIN
      -- SQL_027_FUNCTION_CONTRACT_V1
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||NEW.id::text,0));
      SELECT institute_id INTO reader_institute FROM public.rfid_readers WHERE id=NEW.reader_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RFID reader % for antenna % does not exist',NEW.reader_id,NEW.id; END IF;
      IF reader_institute<>NEW.institute_id THEN
        RAISE EXCEPTION 'RFID antenna and reader must belong to the same institute';
      END IF;
      FOR portal_institute IN
        SELECT p.institute_id FROM public.rfid_portal_antennas pa
        JOIN public.rfid_portals p ON p.id=pa.portal_id
        WHERE pa.antenna_id=OLD.id ORDER BY p.id FOR SHARE OF p
      LOOP
        IF portal_institute<>NEW.institute_id THEN
          RAISE EXCEPTION 'RFID portal and antenna must belong to the same institute';
        END IF;
      END LOOP;
      RETURN NEW;
    END $body$
  $function$;

  EXECUTE $function$
    CREATE FUNCTION public.enforce_rfid_reader_scope_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $body$
    DECLARE mapped_antenna record; current_antenna_institute integer;
    BEGIN
      -- SQL_027_FUNCTION_CONTRACT_V1
      FOR mapped_antenna IN
        SELECT a.id FROM public.rfid_antennas a
        WHERE a.reader_id=OLD.id ORDER BY a.id
      LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rfid-portal-antenna:'||mapped_antenna.id::text,0));
        SELECT a.institute_id INTO current_antenna_institute FROM public.rfid_antennas a
        WHERE a.id=mapped_antenna.id AND a.reader_id=OLD.id
          AND EXISTS (SELECT 1 FROM public.rfid_portal_antennas pa WHERE pa.antenna_id=a.id);
        IF FOUND AND current_antenna_institute<>NEW.institute_id THEN
          RAISE EXCEPTION 'Cannot change institute of an RFID reader with mapped antennas';
        END IF;
      END LOOP;
      RETURN NEW;
    END $body$
  $function$;

  EXECUTE 'CREATE TRIGGER rfid_antenna_scope_update_guard BEFORE UPDATE OF institute_id, reader_id ON public.rfid_antennas FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_antenna_scope_update()';
  EXECUTE 'CREATE TRIGGER rfid_reader_scope_update_guard BEFORE UPDATE OF institute_id ON public.rfid_readers FOR EACH ROW EXECUTE FUNCTION public.enforce_rfid_reader_scope_update()';
  EXECUTE $comment$COMMENT ON FUNCTION public.enforce_rfid_portal_antenna_scope() IS 'Guards RFID configuration integrity only. RFID observations do not directly move assets or mutate custody; canonical asset movement receipt remains authoritative.'$comment$;
  EXECUTE $comment$COMMENT ON FUNCTION public.enforce_rfid_portal_enable_scope() IS 'Guards RFID configuration integrity only. RFID observations do not directly move assets or mutate custody; canonical asset movement receipt remains authoritative.'$comment$;
  EXECUTE $comment$COMMENT ON FUNCTION public.enforce_rfid_antenna_scope_update() IS 'Rejects antenna scope changes that would mismatch a reader or mapped portal; never remaps configuration or moves assets.'$comment$;
  EXECUTE $comment$COMMENT ON FUNCTION public.enforce_rfid_reader_scope_update() IS 'Rejects reader institute changes that would invalidate mapped antennas; never migrates configuration or moves assets.'$comment$;
  EXECUTE $comment$COMMENT ON TRIGGER rfid_portal_antenna_scope_guard ON public.rfid_portal_antennas IS 'Prevents cross-institute and conflicting enabled-portal antenna configuration; never moves assets.'$comment$;
  EXECUTE $comment$COMMENT ON TRIGGER rfid_portal_enable_scope_guard ON public.rfid_portals IS 'Validates configured antennas when a portal is enabled or its institute changes; canonical movement receipt remains authoritative.'$comment$;
  EXECUTE $comment$COMMENT ON TRIGGER rfid_antenna_scope_update_guard ON public.rfid_antennas IS 'Preserves antenna, reader, and mapped-portal institute integrity after antenna updates.'$comment$;
  EXECUTE $comment$COMMENT ON TRIGGER rfid_reader_scope_update_guard ON public.rfid_readers IS 'Preserves mapped antenna institute integrity after reader updates.'$comment$;
END $migration$;

COMMIT;