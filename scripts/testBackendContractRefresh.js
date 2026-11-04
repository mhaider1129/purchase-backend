"use strict";
// Offline source scan + runner-created loopback PostgreSQL only. Never imports
// app/config/db/dotenv or reads any configured database URL or Supabase binding.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { disposableDatabaseUrl } = require("../integration/disposableDatabase");
const { extractBackendSqlContract } = require("./extractBackendSqlContract");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const schemaFile = "sql/manual/059_backend_contract_refresh.sql";
const reportDir = path.join(root, "docs/database-audit/current");
const metadata = JSON.parse(
  read("docs/database-audit/current/contract-refresh.json"),
);
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function run() {
  const name = `p2p_disposable_${crypto.randomBytes(8).toString("hex")}`,
    password = crypto.randomBytes(24).toString("hex");
  let container, client;
  try {
    for (const [file, expected] of Object.entries(metadata.snapshots))
      assert.equal(
        hash(read("sql/" + file)),
        expected,
        "Export changed; re-audit " + file,
      );
    container = execFileSync(
      "docker",
      [
        "--host=unix:///var/run/docker.sock",
        "run",
        "--detach",
        "--rm",
        "--tmpfs",
        "/var/lib/postgresql/data:rw",
        "--publish",
        "127.0.0.1::5432",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_USER=p2p_test",
        "--env",
        `POSTGRES_DB=${name}`,
        "postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, POSTGRES_PASSWORD: password },
      },
    ).trim();
    const address = execFileSync(
      "docker",
      ["--host=unix:///var/run/docker.sock", "port", container, "5432/tcp"],
      { encoding: "utf8" },
    ).trim();
    const url = disposableDatabaseUrl(
      `postgresql://p2p_test:${password}@${address}/${name}`,
    );
    let connected = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      client = new Client({ connectionString: url });
      try {
        await client.connect();
        connected = true;
        break;
      } catch (_) {
        await client.end();
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert(connected, "Disposable PostgreSQL unavailable");
    assert.equal(
      Number(
        (
          await client.query(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
          )
        ).rows[0].count,
      ),
      0,
      "Must use a newly created empty database",
    );
    await client.query("CREATE ROLE anon;CREATE ROLE authenticated;");
    const context = read("sql/View_Supabase_SQL.sql");
    const bodies = Object.fromEntries(
      [
        ...context.matchAll(/CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g),
      ].map((m) => [m[1], m[2]]),
    );
    assert.equal(Object.keys(bodies).length, 100);
    let baseline = "";
    for (const m of context.matchAll(/nextval\('([^']+)'/g))
      baseline += `CREATE SEQUENCE IF NOT EXISTS ${m[1]};\n`;
    for (const [table, body] of Object.entries(bodies)) {
      const normalized = body
        .replace(/\bARRAY(?=\s+NOT NULL)/g, "text[]")
        .replace(/ NOT VALI\)/g, "")
        .replace(/DEFAULT uom_name\b/g, "")
        .replace(
          /,\s*CONSTRAINT\s+\w+\s+FOREIGN KEY\s*\([^)]*\)\s+REFERENCES\s+public\.\w+\s*\([^)]*\)/gi,
          "",
        );
      baseline += `CREATE TABLE public.${table} (${normalized});\n`;
    }
    await client.query(baseline);
    for (const [table, body] of Object.entries(bodies)) {
      const seq = body.match(
        /\bid\s+[^\n]*DEFAULT nextval\('(?:public\.)?([a-z_][a-z0-9_]*)'::regclass\)/i,
      );
      if (seq && seq[1] === `${table}_id_seq`)
        await client.query(
          `ALTER SEQUENCE public.${seq[1]} OWNED BY public.${table}.id`,
        );
    }
    await client.query(read("sql/permissions_Table.sql"));
    await client.query(
      read("sql/UI_resource_permissions.sql").replace(
        /ARRAY\[\]/g,
        "ARRAY[]::text[]",
      ),
    );
    if (process.argv.includes('--device-demos')) {
      await client.query(read(schemaFile));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      await require('../integration/deviceDemoWorkspaces')(client);
      return;
    }
    if (process.argv.includes('--completion')) {
      process.env.DATABASE_URL=disposableDatabaseUrl(url);
      process.env.NODE_ENV='test';
      await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$");
      await client.query(read(schemaFile));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      await client.query(read('sql/manual/060_permission_catalog_refresh.sql'));
      await client.query(read('sql/manual/064_contract_authorization_scope.sql'));
      await client.query(read('sql/manual/065_canonical_contract_finance.sql'));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      await require('../integration/stockFulfilledRequests')(client);
      await require('../integration/technicalWorkflow')(client);
      await require('../integration/procurementCompletion.postgres').run(client,url);
      return;
    }
    if (process.argv.includes('--contracts') || process.argv.includes('--contract-settlement') || process.argv.includes('--request-workspace') || process.argv.includes('--contract-finance') || process.argv.includes('--contract-reconciliation')) {
      await client.query(read(schemaFile));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      await client.query(read('sql/manual/060_permission_catalog_refresh.sql'));
      await client.query(read('sql/manual/064_contract_authorization_scope.sql'));
      await client.query(read('sql/manual/064_contract_authorization_scope.sql'));
      if(process.argv.includes('--contract-reconciliation')) {
        const baseline=require('../integration/canonicalContractFinance.postgres');
        const before=await baseline.prepareUpgrade(client);
        await client.query(read('sql/manual/065_canonical_contract_finance.sql'));
        await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$");
        await client.query(read('sql/manual/066_contract_financial_reconciliation.sql'));
        await client.query(read('sql/manual/066_contract_financial_reconciliation.sql'));
        await baseline.verifyUpgrade(client,before);
        await baseline.run(client,url,{after:require('../integration/contractFinancialReconciliation.postgres').run});
        return;
      }
      if(process.argv.includes('--contract-finance')) {
        const integration=require('../integration/canonicalContractFinance.postgres');
        const upgrade=await integration.prepareUpgrade(client);
        await client.query(read('sql/manual/065_canonical_contract_finance.sql'));
        await client.query(read('sql/manual/065_canonical_contract_finance.sql'));
        await integration.verifyUpgrade(client,upgrade);
        await integration.run(client,url);
        return;
      }
      await require(process.argv.includes('--request-workspace')?'../integration/requestWorkspace.postgres':process.argv.includes('--contract-settlement')?'../integration/legacyContractSettlement.postgres':'../integration/contracts.postgres').run(client,url);
      return;
    }
    const columns = async () =>
      (
        await client.query(
          "SELECT table_name,column_name,data_type,is_nullable,column_default,udt_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
        )
      ).rows;
    const before = await columns();
    const permissionsBefore = (
      await client.query("SELECT * FROM permissions ORDER BY id")
    ).rows;
    const uiBefore = (
      await client.query(
        "SELECT * FROM ui_resource_permissions ORDER BY resource_key",
      )
    ).rows;
    await client.query(
      "INSERT INTO roles(id,name) VALUES(1,'Contract preservation role'); INSERT INTO users(id,name,email,password,role) VALUES(1,'Preserved account','contract@example.invalid','test-only-hash','Contract preservation role'); INSERT INTO role_permissions(role_id,permission_id) SELECT 1,id FROM permissions ORDER BY id LIMIT 1; INSERT INTO user_permissions(user_id,permission_id) SELECT 1,id FROM permissions ORDER BY id LIMIT 1;",
    );
    const grants = async () =>
      (
        await client.query(
          "SELECT 'role' source,role_id subject,permission_id FROM role_permissions UNION ALL SELECT 'user',user_id,permission_id FROM user_permissions ORDER BY 1,2,3",
        )
      ).rows;
    const grantsBefore = await grants();
    // A partial same-name index is a real incompatible prerequisite. The new
    // patch must establish semantic uniqueness rather than skip by index name.
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO notifications(user_id,title,message,outbox_event_id) VALUES(1,'Preserve duplicate A','Test only',42),(1,'Preserve duplicate B','Test only',42)",
    );
    await assert.rejects(
      client.query(read(schemaFile)),
      (error) => error.code === "23505",
    );
    await client.query("ROLLBACK");
    console.log(
      "Duplicate notification history aborts without deleting or merging records PASS",
    );
    await client.query(
      "CREATE UNIQUE INDEX notifications_outbox_event_uq ON notifications(outbox_event_id) WHERE outbox_event_id IS NOT NULL",
    );
    await client.query(
      "BEGIN;CREATE TABLE delivery_inspection_tasks(id bigint PRIMARY KEY);INSERT INTO delivery_inspection_tasks VALUES(1);",
    );
    await assert.rejects(
      client.query(read(schemaFile)),
      /Populated partial module delivery_inspection_tasks/,
    );
    await client.query("ROLLBACK");
    console.log(
      "Populated partial module rejects without invented values PASS",
    );
    // A populated module with known optional metadata gaps must upgrade without
    // invented timestamps or rewritten financial results. Exercise inside an outer
    // transaction and roll back the fixture, not the owner-facing patch semantics.
    await client.query("BEGIN");
    const oldResultCreate = read(
      "sql/manual/035_backend_schema_reconciliation.sql",
    ).match(
      /CREATE TABLE IF NOT EXISTS public\.procurement_evaluation_results \([\s\S]*?\n\);/,
    )[0];
    await client.query(
      oldResultCreate.replace(
        /^  (?:created_at|updated_at) timestamptz.*\n/gm,
        "",
      ),
    );
    await client.query(
      "INSERT INTO procurement_evaluation_results(tco_period_cost,final_weighted_score,compliance_passed) VALUES(12345.67,75.125,false)",
    );
    const historic = (
      await client.query(
        "SELECT to_jsonb(r) value FROM procurement_evaluation_results r",
      )
    ).rows[0].value;
    const patchBody = read(schemaFile)
      .replace(/^BEGIN;\s*$/m, "")
      .replace(/\nCOMMIT;\s*$/, "");
    await client.query(patchBody);
    const upgraded = (
      await client.query(
        "SELECT to_jsonb(r)-'created_at'-'updated_at' value,created_at,updated_at FROM procurement_evaluation_results r",
      )
    ).rows[0];
    assert.deepEqual(upgraded.value, historic);
    assert.equal(upgraded.created_at, null);
    assert.equal(upgraded.updated_at, null);
    await client.query("ROLLBACK");
    console.log(
      "Known populated evaluation metadata upgrade preserves results and unknown history PASS",
    );
    const verifyFile = "sql/manual/063_backend_contract_verify.sql";
    if (fs.existsSync(path.join(root, verifyFile))) {
      const pre = (await client.query(read(verifyFile))).rows;
      assert.equal(
        Number(
          pre.find((r) => r.check_name === "missing_permission_definitions")
            .finding_count,
        ),
        1,
      );
      assert.equal(
        Number(
          pre.find((r) => r.check_name === "missing_ui_resource_keys")
            .finding_count,
        ),
        1,
      );
      assert.equal(
        Number(
          pre.find((r) => r.check_name === "notification_retry_uniqueness")
            .finding_count,
        ),
        2,
      );
      assert.equal(
        Number(
          pre.find((r) => r.check_name === "narrow_sha256_columns")
            .finding_count,
        ),
        4,
      );
      console.log("Read-only preflight detects actual export gaps PASS");
    }
    for (let pass = 1; pass <= 2; pass++) {
      try {
        await client.query(read(schemaFile));
      await client.query(read('sql/manual/067_canonical_procurement_completion.sql'));
      } catch (error) {
        console.error(
          "Patch context:",
          error.where || error.detail || "",
          error.position
            ? read(schemaFile).slice(
                Math.max(0, Number(error.position) - 180),
                Number(error.position) + 180,
              )
            : "",
        );
        throw error;
      }
      await client.query(read("sql/manual/060_permission_catalog_refresh.sql"));
      await client.query(
        read("sql/manual/061_ui_resource_catalog_refresh.sql"),
      );
      if (pass === 1) {
        await client.query(
          "INSERT INTO institutes(id,name) VALUES(1,'Schema fixture institute A'),(2,'Schema fixture institute B'); INSERT INTO users(id,name,email,password,role,institute_id) VALUES(2,'Scoped A','scoped-a@example.invalid','test-only-hash','Scoped fixture',1),(3,'Scoped B','scoped-b@example.invalid','test-only-hash','Scoped fixture',2); INSERT INTO planning_settings(institute_id,warehouse_id) VALUES(1,NULL),(2,NULL); INSERT INTO request_auto_assignment_rules(institute_id,request_type,assignee_user_id) VALUES(1,'Non-Stock',2),(2,'Non-Stock',3); UPDATE procurement_identity_policy SET enforce_item_identity=false,reason='Preserve explicit operational configuration' WHERE id=1",
        );
      }
      console.log("Complete patch application", pass, "PASS");
    }
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM permissions WHERE id=ANY($1::int[]) ORDER BY id",
          [permissionsBefore.map((p) => p.id)],
        )
      ).rows,
      permissionsBefore,
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM ui_resource_permissions WHERE resource_key=ANY($1::text[]) ORDER BY resource_key",
          [uiBefore.map((r) => r.resource_key)],
        )
      ).rows,
      uiBefore,
    );
    assert.deepEqual(await grants(), grantsBefore);
    assert.equal(
      (
        await client.query(
          "SELECT count(*) n FROM planning_settings WHERE institute_id IS NOT NULL",
        )
      ).rows[0].n,
      "2",
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) n FROM request_auto_assignment_rules WHERE institute_id IS NOT NULL",
        )
      ).rows[0].n,
      "2",
    );
    assert.equal(
      (
        await client.query(
          "SELECT enforce_item_identity FROM procurement_identity_policy WHERE id=1",
        )
      ).rows[0].enforce_item_identity,
      false,
    );
    console.log(
      "Repeated patch preserves institute-specific global defaults, assignment rules and explicit policy choice PASS",
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) FROM permissions WHERE code='approval-authority.cmo'",
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) FROM ui_resource_permissions WHERE resource_key='feature.procurementPlanning'",
        )
      ).rows[0].count,
      "1",
    );
    if (fs.existsSync(path.join(root, verifyFile))) {
      const post = (await client.query(read(verifyFile))).rows;
      for (const item of post.filter(
        (r) => r.category === "missing_or_invalid",
      ))
        assert.equal(Number(item.finding_count), 0, JSON.stringify(item));
      console.log(
        "Read-only postflight has zero missing_or_invalid findings PASS",
      );
    }
    const shaTypes = (
      await client.query(
        "SELECT table_name,data_type,character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('goods_receipts','supplier_invoices','ap_vouchers','payment_records') AND column_name='payload_fingerprint'",
      )
    ).rows;
    assert.equal(shaTypes.length, 4);
    shaTypes.forEach((c) =>
      assert(c.data_type === "text" || c.character_maximum_length >= 64),
    );
    // Optional alignment is tested separately; the default UI patch above preserved
    // every supplied rule. A concurrently customized policy must never be overwritten.
    await client.query(
      read("sql/manual/062_demand_planning_ui_policy_alignment.sql"),
    );
    const aligned = (
      await client.query(
        "SELECT permissions FROM ui_resource_permissions WHERE resource_key='feature.demandPlanning'",
      )
    ).rows[0].permissions;
    assert.deepEqual(aligned, [
      "planning.view",
      "planning.manage",
      "replenishment.manage",
    ]);
    const policyAudit = (
      await client.query(
        "SELECT count(*) n FROM audit_logs WHERE action='ui_resource.policy_aligned'",
      )
    ).rows[0].n;
    await client.query(
      read("sql/manual/062_demand_planning_ui_policy_alignment.sql"),
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) n FROM audit_logs WHERE action='ui_resource.policy_aligned'",
        )
      ).rows[0].n,
      policyAudit,
    );
    await client.query(
      "UPDATE ui_resource_permissions SET permissions=ARRAY['requests.view-all'],require_all=true WHERE resource_key='feature.demandPlanning'",
    );
    await client.query(
      read("sql/manual/062_demand_planning_ui_policy_alignment.sql"),
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT permissions,require_all FROM ui_resource_permissions WHERE resource_key='feature.demandPlanning'",
        )
      ).rows[0],
      { permissions: ["requests.view-all"], require_all: true },
    );
    console.log(
      "Optional exact-match UI policy alignment, retries, audit and custom policy preservation PASS",
    );
    const after = await columns();
    const beforeKeys = new Set(
      before.map((r) => r.table_name + "." + r.column_name),
    );
    const missing = after.filter(
      (r) => !beforeKeys.has(r.table_name + "." + r.column_name),
    );
    const missingTables = [...new Set(after.map((r) => r.table_name))].filter(
      (t) => !Object.hasOwn(bodies, t),
    );
    const extraction = extractBackendSqlContract(root),
      failures = [],
      passed = [],
      skipped = [];
    for (const row of extraction.sql) {
      const sql = row.value.trim();
      if (
        !row.queryCall ||
        sql.includes("${") ||
        !/^(SELECT|WITH|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(sql) ||
        /;\s*\S/.test(sql)
      ) {
        skipped.push({
          source: row.source,
          line: row.line,
          reason: sql.includes("${")
            ? "dynamic template"
            : "non-direct or non-DML literal",
        });
        continue;
      }
      const count = Math.max(
        0,
        ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
      );
      try {
        await client.query("EXPLAIN " + sql, new Array(count).fill(null));
        passed.push({ source: row.source, line: row.line });
      } catch (error) {
        failures.push({
          source: row.source,
          line: row.line,
          code: error.code,
          message: error.message,
          sql,
        });
      }
    }
    const indirect = { passed: 0, review: [] };
    for (const row of extraction.sql) {
      const sql = row.value.trim();
      if (
        row.queryCall ||
        sql.includes("${") ||
        !/^(SELECT|WITH|INSERT INTO|UPDATE|DELETE FROM)\s+/i.test(sql) ||
        /;\s*\S/.test(sql)
      )
        continue;
      const count = Math.max(
        0,
        ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
      );
      try {
        await client.query("EXPLAIN " + sql, new Array(count).fill(null));
        indirect.passed++;
      } catch (error) {
        indirect.review.push({
          source: row.source,
          line: row.line,
          code: error.code,
          message: error.message,
          sql,
          classification:
            error.code === "42601"
              ? "non_SQL_application_message"
              : "correlated_or_incomplete_SQL_fragment_requires_parent_assembly",
        });
      }
    }
    const moduleCache = new Map(),
      vm = require("node:vm");
    function sourceModule(file) {
      file = path.resolve(file);
      if (!file.startsWith(root + path.sep))
        throw Error("Audit module outside backend");
      if (file === path.join(root, "config/db.js"))
        return {
          query() {
            throw Error("Audit module attempted database access");
          },
          connect() {
            throw Error("Audit module attempted database access");
          },
        };
      if (moduleCache.has(file)) return moduleCache.get(file).exports;
      const module = { exports: {} };
      moduleCache.set(file, module);
      const requireSource = (name) => {
        if (["crypto", "node:crypto", "node:async_hooks"].includes(name))
          return require(name);
        if (!name.startsWith("."))
          throw Error("Unreviewed audit module dependency " + name);
        return sourceModule(
          path.resolve(path.dirname(file), name) +
            (path.extname(name) ? "" : ".js"),
        );
      };
      vm.runInNewContext(
        "(function(require,module,exports){" +
          fs.readFileSync(file, "utf8") +
          "\n})",
        {},
        { filename: file },
      )(requireSource, module, module.exports);
      return module.exports;
    }
    const readScope = sourceModule(path.join(root, "services/p2pReadScope.js"));
    const queries = [];
    for (const [kind, table] of Object.entries({
      request: "requests",
      award: "procurement_awards",
      purchaseOrder: "purchase_orders",
      receipt: "goods_receipts",
      invoice: "supplier_invoices",
      match: "invoice_match_results",
      voucher: "ap_vouchers",
      payable: "ap_payables",
      payment: "payment_records",
      budget: "budget_envelopes",
      commitment: "commitment_ledger",
      financePosting: "finance_postings",
    }))
      queries.push(
        `SELECT a.id FROM ${table} a WHERE ${readScope.predicate(kind, "a")}`,
      );
    queries.push(
      `SELECT a.id FROM document_flow_links a WHERE ${readScope.flowPredicate("a")}`,
    );
    queries.push(
      `SELECT a.id FROM journal_entries a WHERE ${readScope.invoiceJournalPredicate("a")}`,
    );
    const rfx = sourceModule(path.join(root, "services/rfxAuthorization.js"));
    queries.push(
      `SELECT e.id FROM rfx_events e WHERE ${rfx.eventPredicate("e")}`,
    );
    queries.push(
      `SELECT resp.id FROM rfx_responses resp JOIN rfx_events e ON e.id=resp.rfx_id WHERE ${rfx.eventPredicate("e")} AND ${rfx.responsePredicate()}`,
    );
    queries.push(
      `SELECT pa.id FROM procurement_awards pa WHERE ${rfx.awardSourcePredicate("pa")}`,
    );
    const evaluation = sourceModule(
      path.join(root, "services/procurementEvaluationAuthorization.js"),
    );
    queries.push(
      `SELECT c.id FROM procurement_evaluation_cases c WHERE ${evaluation.predicate("c")}`,
    );
    for (const sql of queries) {
      const count = Math.max(
        0,
        ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
      );
      await client.query("EXPLAIN " + sql, new Array(count).fill(null));
    }
    const relations = (
      await client.query(
        "SELECT c.relname name,c.relkind kind,c.relrowsecurity rls,c.reloptions options FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v') ORDER BY c.relname",
      )
    ).rows;
    const indexes = (
      await client.query(
        "SELECT t.relname table_name,c.relname index_name,i.indisunique unique_index,i.indisvalid valid,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.relname",
      )
    ).rows;
    const functions = (
      await client.query(
        "SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,p.oid::regprocedure::text signature,p.prosecdef security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname",
      )
    ).rows;
    const triggers = (
      await client.query(
        "SELECT c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
      )
    ).rows;
    const defaultDifferences = metadata.uiDefaults.flatMap((expected) => {
      const existing = uiBefore.find(
        (r) => r.resource_key === expected.resourceKey,
      );
      return existing &&
        (JSON.stringify([...existing.permissions].sort()) !==
          JSON.stringify([...expected.permissions].sort()) ||
          existing.require_all !== expected.requireAll)
        ? [
            {
              resourceKey: expected.resourceKey,
              exportPermissions: existing.permissions,
              currentDefaultPermissions: expected.permissions,
              exportRequireAll: existing.require_all,
              currentDefaultRequireAll: expected.requireAll,
            },
          ]
        : [];
    });
    fs.writeFileSync(
      path.join(reportDir, "database-objects.json"),
      JSON.stringify({ relations, indexes, functions, triggers }, null, 2) +
        "\n",
    );
    fs.writeFileSync(
      path.join(reportDir, "ui-policy-review.json"),
      JSON.stringify(
        {
          exportRows: uiBefore.length,
          currentBackendDefaults: metadata.uiDefaults.length,
          missing: metadata.uiDefaults.filter(
            (d) => !uiBefore.some((r) => r.resource_key === d.resourceKey),
          ),
          existingPolicyDifferences: defaultDifferences,
          policy:
            "Existing customized resource policies are preserved; differences require owner review, not automatic privilege changes.",
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(reportDir, "indirect-query-review.json"),
      JSON.stringify(indirect, null, 2) + "\n",
    );
    assert.equal(failures.length, 0, JSON.stringify(failures));
    const results = {
      baselineRef: metadata.baselineRef,
      snapshotTables: Object.keys(bodies).length,
      snapshotColumns: before.length,
      requiredTables: relations.filter((r) => r.kind === "r" || r.kind === "p")
        .length,
      requiredViews: relations.filter((r) => r.kind === "v").length,
      requiredRelations: relations.length,
      requiredColumns: after.length,
      missingRelations: missingTables,
      missingTables: missingTables.filter(
        (t) => relations.find((r) => r.name === t)?.kind !== "v",
      ),
      missingViews: missingTables.filter(
        (t) => relations.find((r) => r.name === t)?.kind === "v",
      ),
      missingColumns: missing.filter((r) =>
        Object.hasOwn(bodies, r.table_name),
      ),
      static: {
        stringCount: extraction.stringCount,
        sqlLiteralCount: extraction.sql.length,
        plansPassed: passed.length,
        failures,
        skippedCount: skipped.length,
        indirectPassed: indirect.passed,
        indirectReview: indirect.review.length,
        generatedPredicatesPassed: queries.length,
      },
      checks: [
        "new empty loopback-only PostgreSQL",
        "partial populated modules abort",
        "repeat complete application",
        "existing permission metadata preserved",
        "existing UI rules preserved",
        "role/user grants unchanged",
        "partial notification index repaired semantically",
        "owner-facing read-only preflight and postflight",
        "duplicate notification history aborts without deletion",
        "known populated evaluation metadata preserves values and unknown timestamps",
        "repeat application preserves institute-scoped globals and assignment rules",
        "explicit operational policy choice preserved",
        "optional exact-match UI alignment audits once and preserves custom rules",
        "all four existing SHA-256 columns support full payload hashes",
      ],
    };
    fs.writeFileSync(
      path.join(reportDir, "validation-results.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
    const grouped = {};
    for (const c of after) {
      (grouped[c.table_name] ||= {})[c.column_name] = {
        type: c.data_type,
        udt: c.udt_name,
        nullable: c.is_nullable,
        default: c.column_default,
      };
    }
    fs.writeFileSync(
      path.join(reportDir, "required-columns.json"),
      JSON.stringify(grouped, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        tables: results.requiredTables,
        columns: after.length,
        missingRelations: missingTables.length,
        missingExistingColumns: results.missingColumns.length,
        plansPassed: passed.length,
        plansFailed: failures.length,
      }),
    );
    for (const f of failures)
      console.log(`${f.source}:${f.line} ${f.code} ${f.message}`);
  } finally {
    if (client) await client.end();
    if (container)
      execFileSync(
        "docker",
        ["--host=unix:///var/run/docker.sock", "rm", "--force", container],
        { stdio: "ignore" },
      );
  }
}
run().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
