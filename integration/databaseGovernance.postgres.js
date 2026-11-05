"use strict";
const assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { Client } = require("pg");
const catalog = require("../scripts/lib/databaseRelease/catalog");
const {
  inventory: scan,
  root,
} = require("../scripts/lib/databaseRelease/inventory");
const {
  bundle,
  selectMigrations,
  validateOrder,
} = require("../scripts/lib/databaseRelease/planner");
const version = "hospital-erp-2026-11-7b";
async function run(client, url) {
  const ownerUrl = require("./disposableDatabase").disposableDatabaseUrl(url);
  process.env.DATABASE_URL = ownerUrl;
  process.env.NODE_ENV = "test";
  const dir = path.join(root, "database/releases");
  if (process.argv.includes("--capture-database-contract")) {
    const contract = {
      version,
      baseline_ref: "68c36468",
      catalog: await catalog.snapshot(client),
    };
    fs.writeFileSync(
      path.join(dir, "schema-contract.json"),
      JSON.stringify(contract, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "migration-inventory.json"),
      JSON.stringify(scan(), null, 2) + "\n",
    );
    console.log(
      "Captured disposable expected contract, not historical execution evidence",
    );
  }
  const service = require("../services/databaseReleaseService"),
    contract = service.loadContract(),
    inventory = service.loadInventory();
  const options = {
    contract,
    inventory,
    releaseRef: "aud010-local",
    environment: "disposable",
    role: "purchase_backend",
  };
  const report = () => service.verify(client, options);
  const plan = (extra = {}) =>
    bundle({
      contract,
      inventory,
      environment: "disposable",
      actor: "local-test-operator",
      releaseRef: "aud010-local",
      ...extra,
    });
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS governance ${name}`);
    passed++;
  };
  const one = async (q, p = []) => (await client.query(q, p)).rows[0];
  const probe = async (sql, check) => {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      const r = await report();
      assert.equal(r.status, "BLOCKED");
      assert(r.findings.some(check), JSON.stringify(r.findings).slice(0, 1000));
    } finally {
      await client.query("ROLLBACK");
    }
  };
  const hashRows = async (tables) => {
    const result = {};
    for (const t of tables)
      result[t] = (
        await one(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'[]')) digest FROM public.${t} r`,
        )
      ).digest;
    return result;
  };
  const initial = await service.verify(client, {
    ...options,
    requireEvidence: false,
  });
  assert.deepEqual(initial.findings, []);
  await test("empty databases reject forward release without pretending a bootstrap happened", async () => {
    const name = "p2p_disposable_" + crypto.randomBytes(8).toString("hex");
    await client.query(`CREATE DATABASE ${name}`);
    const target = new URL(ownerUrl);
    target.pathname = "/" + name;
    const empty = new Client({
      connectionString: require("./disposableDatabase").disposableDatabaseUrl(
        target.toString(),
      ),
    });
    try {
      await empty.connect();
      await assert.rejects(
        () =>
          empty.query(
            fs.readFileSync(
              path.join(root, "sql/manual/070_rfid_processing_recovery.sql"),
              "utf8",
            ),
          ),
        /PREREQUISITES_MISSING/,
      );
      await empty.query("ROLLBACK");
      assert.equal(
        (
          await empty.query(
            "SELECT to_regclass('public.database_release_migrations') ledger",
          )
        ).rows[0].ledger,
        null,
      );
    } finally {
      await empty.end();
    }
  });
  await test("schema verification alone never claims historical execution or release readiness", async () => {
    assert.equal(initial.status, "SCHEMA_VERIFIED_UNATTESTED");
    const r = await report();
    assert.equal(r.status, "BLOCKED");
    assert(r.findings.some((f) => f.group === "ledger"));
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM database_release_migrations WHERE migration_id LIKE '070_%'",
        )
      ).n,
      0,
    );
  });
  // Simulate permissive hosted defaults on a precreated governance namespace.
  await client.query(
    "GRANT ALL ON public.rfid_processing_attempts TO authenticated; GRANT TRUNCATE ON public.rfid_processing_attempts TO purchase_backend",
  );
  await client.query(plan());
  await test("transactional manual bundle records actual forward execution and current attestation", async () => {
    const r = await report();
    assert.equal(r.status, "DATABASE_READY", JSON.stringify(r.findings));
    assert.equal(
      r.receipts.filter((row) => row.execution_environment === "disposable")
        .length,
      2,
    );
    assert.equal(
      (
        await one(
          "SELECT has_table_privilege('authenticated','public.rfid_processing_attempts','INSERT') allowed",
        )
      ).allowed,
      false,
    );
    assert.equal(
      (
        await one(
          "SELECT has_table_privilege('purchase_backend','public.rfid_processing_attempts','TRUNCATE') allowed",
        )
      ).allowed,
      false,
    );
    assert.equal(
      r.receipts.find((row) => row.migration_id.startsWith("070_"))
        .migration_id,
      "070_rfid_processing_recovery",
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM database_release_migrations WHERE migration_id ~ '^0[0-6][0-8]_' AND execution_status='APPLIED'",
        )
      ).n,
      0,
    );
  });
  await test("repeat governed execution is idempotent and preserves evidence", async () => {
    const before = await hashRows([
      "database_release_migrations",
      "database_release_attestations",
      "evaluation_criteria",
    ]);
    await client.query(plan());
    assert.deepEqual(await hashRows(Object.keys(before)), before);
  });
  await test("missing prerequisite completion function blocks preflight before writes", async () => {
    await client.query("BEGIN");
    try {
      await client.query(
        "DROP FUNCTION public.canonical_procurement_completion(integer,integer,integer)",
      );
      await assert.rejects(
        () =>
          client.query(
            plan({
              environment: "staging",
              releaseRef: "missing-prerequisite",
            }),
          ),
        /DATABASE_CONTRACT_INVALID/,
      );
    } finally {
      await client.query("ROLLBACK");
    }
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM database_release_migrations WHERE execution_environment='staging' AND migration_id LIKE '070_%'",
        )
      ).n,
      0,
    );
  });
  await test("incorrect dependency order is rejected without connecting", async () => {
    assert.throws(
      () =>
        validateOrder([
          { path: "sql/manual/070_child.sql", depends_on: ["069_parent"] },
          { path: "sql/manual/069_parent.sql" },
        ]),
      /MIGRATION_ORDER/,
    );
  });
  await test("checksum mismatch and frozen replay are rejected before execution", async () => {
    const tampered = structuredClone(inventory);
    tampered.artifacts.find((e) => e.path.includes("070_")).sha256 = "0".repeat(
      64,
    );
    assert.throws(() => selectMigrations(tampered), /CHECKSUM_MISMATCH/);
    assert.throws(
      () =>
        selectMigrations(inventory, ["067_canonical_procurement_completion"]),
      /FROZEN_REPLAY_DISABLED/,
    );
  });
  await test("missing required table is not database-ready", () =>
    probe(
      "DROP TABLE public.database_release_attestations",
      (f) => f.group === "relations",
    ));
  await test("wrong physical column type is not database-ready", () =>
    probe(
      "ALTER TABLE public.requests ALTER COLUMN justification TYPE varchar(10)",
      (f) => f.group === "columns" && f.object === "requests.justification",
    ));
  const index = contract.catalog.indexes.find(
    (i) => i.name === "ix_inventory_ledger_scope",
  );
  assert(index);
  await test("missing valid inventory index is not database-ready", () =>
    probe(
      `DROP INDEX public.${index.name}`,
      (f) => f.group === "indexes" && f.object.endsWith(index.name),
    ));
  const fk = contract.catalog.constraints.find(
    (c) => c.relation === "goods_receipt_items" && c.type === "f",
  );
  assert(fk);
  await test("missing required foreign key is not database-ready", () =>
    probe(
      `ALTER TABLE public.goods_receipt_items DROP CONSTRAINT ${fk.name}`,
      (f) => f.group === "constraints" && f.object.endsWith(fk.name),
    ));
  await test("incorrect function signature is not accepted as equivalent", () =>
    probe(
      "DROP FUNCTION public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint); CREATE FUNCTION public.canonical_receipt_inventory_quantity(bigint) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric'",
      (f) =>
        f.group === "functions" &&
        f.object.startsWith("canonical_receipt_inventory_quantity"),
    ));
  await test("missing required capability definition blocks readiness", () =>
    probe(
      "DELETE FROM public.permissions WHERE code='requests.cross-institute'",
      (f) =>
        f.group === "permissions" && f.object === "requests.cross-institute",
    ));
  await test("disabled required RLS blocks readiness", () =>
    probe(
      "ALTER TABLE public.database_release_migrations DISABLE ROW LEVEL SECURITY",
      (f) =>
        f.group === "relations" && f.object === "database_release_migrations",
    ));
  await test("missing SQL 067 function blocks current application compatibility", () =>
    probe(
      "DROP FUNCTION public.canonical_procurement_completion(integer,integer,integer)",
      (f) =>
        f.group === "functions" &&
        f.object.startsWith("canonical_procurement_completion"),
    ));
  await test("missing SQL 068 function blocks current application compatibility", () =>
    probe(
      "DROP FUNCTION public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)",
      (f) =>
        f.group === "functions" &&
        f.object.startsWith("canonical_receipt_inventory_quantity"),
    ));
  await test("partial migration failure rolls back DDL and cannot record APPLIED", async () => {
    const before = await hashRows([
      "database_release_migrations",
      "database_release_attestations",
      "finance_chart_of_accounts",
    ]);
    const sql = plan({
      environment: "staging",
      releaseRef: "deliberately-failed",
    }).replace(
      " INSERT INTO public.database_release_migrations",
      " CREATE TABLE public.aud010_should_rollback(id integer); RAISE EXCEPTION 'AUD010_INJECTED_POSTFLIGHT_FAILURE';\n INSERT INTO public.database_release_migrations",
    );
    await assert.rejects(() => client.query(sql), /AUD010_INJECTED/);
    await client.query("ROLLBACK");
    assert.equal(
      (await one("SELECT to_regclass('public.aud010_should_rollback') t")).t,
      null,
    );
    assert.deepEqual(await hashRows(Object.keys(before)), before);
  });
  await test("simultaneous migration attempts fail fast under the shared transaction lock", async () => {
    const other = new Client({ connectionString: ownerUrl });
    await other.connect();
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('purchase-tracker:database-release',0))",
      );
      await assert.rejects(() => other.query(plan()), /DATABASE_RELEASE_BUSY/);
      await other.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      await other.end();
    }
  });
  await test("incompatible startup refuses listener and worker callback", async () => {
    let started = false;
    await client.query("BEGIN");
    try {
      await client.query(
        "DROP FUNCTION public.canonical_procurement_completion(integer,integer,integer)",
      );
      await assert.rejects(
        () =>
          service.startWhenReady(
            client,
            { releaseRef: "aud010-local", environment: "disposable" },
            () => {
              started = true;
            },
          ),
        (e) => e.code === "DATABASE_RELEASE_INCOMPATIBLE",
      );
      assert.equal(started, false);
    } finally {
      await client.query("ROLLBACK");
    }
  });
  const institute = await one(
    "INSERT INTO institutes(name) VALUES('Governance disposable hospital') RETURNING id",
  );
  const department = await one(
    "INSERT INTO departments(name,type,institute_id) VALUES('Governance archive','Operational',$1) RETURNING id",
    [institute.id],
  );
  const request = await one(
    "INSERT INTO requests(request_type,status,institute_id,department_id) VALUES('Stock','Approved',$1,$2) RETURNING id",
    [institute.id, department.id],
  );
  await client.query(
    "INSERT INTO payment_records(request_id,amount_paid,payment_reference,payment_status,currency) VALUES($1,123.45,'AUD010 historical payment','paid','USD')",
    [request.id],
  );
  const stock = await one(
    "INSERT INTO stock_items(name,unit) VALUES('AUD010 historical stock','EA') RETURNING id",
  );
  await client.query(
    "INSERT INTO inventory_transactions(transaction_type,movement_type,stock_item_id,quantity,stock_status,institute_id,notes) VALUES('receipt','GOODS_RECEIPT',$1,7.125,'QUARANTINE',$2,'Preserved historical fixture; not acceptance evidence')",
    [stock.id, institute.id],
  );
  const financial = [
    "payment_records",
    "supplier_invoices",
    "ap_payables",
    "journal_entries",
    "journal_entry_lines",
    "gl_postings",
    "gl_posting_lines",
    "contract_invoices",
    "contract_payments",
  ];
  const inventoryTables = [
    "inventory_transactions",
    "inventory_transaction_allocations",
    "warehouse_stock_levels",
  ];
  const historical = await hashRows([...financial, ...inventoryTables]);
  await test("populated forward migration preserves historical payment and inventory records", async () => {
    await client.query(
      plan({ environment: "staging", releaseRef: "populated-release" }),
    );
    assert.deepEqual(await hashRows(Object.keys(historical)), historical);
  });
  await test("read-only repeatable verification performs no business or evidence mutation", async () => {
    const before = await hashRows([
      ...financial,
      ...inventoryTables,
      "database_release_migrations",
      "database_release_attestations",
    ]);
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    try {
      assert.equal((await report()).status, "DATABASE_READY");
    } finally {
      await client.query("ROLLBACK");
    }
    assert.deepEqual(await hashRows(Object.keys(before)), before);
  });
  await test("historical financial values remain identical after schema verification", async () => {
    assert.deepEqual(
      await hashRows(financial),
      Object.fromEntries(financial.map((k) => [k, historical[k]])),
    );
    assert.equal(
      (
        await one(
          "SELECT amount_paid::text amount FROM payment_records WHERE request_id=$1",
          [request.id],
        )
      ).amount,
      "123.45",
    );
  });
  await test("historical quarantined inventory remains identical and creates no balance", async () => {
    assert.deepEqual(
      await hashRows(inventoryTables),
      Object.fromEntries(inventoryTables.map((k) => [k, historical[k]])),
    );
    assert.equal(
      (
        await one(
          "SELECT quantity::text quantity FROM inventory_transactions WHERE stock_item_id=$1",
          [stock.id],
        )
      ).quantity,
      "7.125",
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM warehouse_stock_levels WHERE stock_item_id=$1",
          [stock.id],
        )
      ).n,
      0,
    );
  });
  await test("effective runtime permissions include function execution and exclude ledger writes", async () => {
    await probe(
      "REVOKE EXECUTE ON FUNCTION public.canonical_procurement_completion(integer,integer,integer) FROM purchase_backend",
      (f) => f.group === "runtime_privilege" && f.reason === "EXECUTE_missing",
    );
    await probe(
      "GRANT INSERT ON public.database_release_migrations TO purchase_backend",
      (f) =>
        f.group === "runtime_privilege" &&
        f.reason === "release_evidence_writable_by_runtime",
    );
  });
  const password = crypto.randomBytes(24).toString("hex");
  await client.query(
    `ALTER ROLE purchase_backend LOGIN PASSWORD '${password}'`,
  );
  const backendUrl = new URL(ownerUrl);
  backendUrl.username = "purchase_backend";
  backendUrl.password = password;
  const backend = new Client({ connectionString: backendUrl.toString() });
  await backend.connect();
  try {
    await test("actual non-owner backend connection passes gate and cannot execute persistent DDL", async () => {
      const r = await service.verify(backend, {
        releaseRef: "aud010-local",
        environment: "disposable",
      });
      assert.equal(r.status, "DATABASE_READY", JSON.stringify(r.findings));
      await assert.rejects(
        () => backend.query("CREATE TABLE public.aud010_denied(id integer)"),
        (e) => e.code === "42501",
      );
      await assert.rejects(
        () =>
          backend.query(
            "INSERT INTO database_release_migrations(migration_id) VALUES('fake')",
          ),
        (e) => e.code === "42501",
      );
    });
    await test("runtime SQL guard and installed compatibility checks are read-only under the backend role", async () => {
      require("../utils/runtimeSqlGuard").guard(backend);
      await assert.rejects(
        () =>
          backend.query("DO $$ BEGIN CREATE TABLE public.bad(id int); END $$"),
        (e) => e.code === "RUNTIME_DDL_DISABLED",
      );
      const modules = JSON.parse(
        fs.readFileSync(
          path.join(root, "database/releases/runtime-modules.json"),
          "utf8",
        ),
      );
      assert.equal(Object.keys(modules).length, 44);
      for (const key of Object.keys(modules))
        await require("../utils/runtimeSchemaContract").assertModuleContract(
          key,
          backend,
        );
      const before = await hashRows([...financial, ...inventoryTables]);
      await require("../utils/ensureRequestedItemReceivedColumns")(backend);
      await require("../utils/ensureFinanceCoreTables").ensureFinanceCoreTables(
        backend,
      );
      assert.deepEqual(await hashRows(Object.keys(before)), before);
    });
    await test("startup success is bound to actual role, source digest and reviewed application release", async () => {
      let started = false;
      await service.startWhenReady(
        backend,
        { releaseRef: "aud010-local", environment: "disposable" },
        () => {
          started = true;
        },
      );
      assert(started);
      await assert.rejects(
        () =>
          service.startWhenReady(
            backend,
            { releaseRef: "unreviewed-release", environment: "disposable" },
            () => {
              throw Error("must not start");
            },
          ),
        (e) => e.code === "DATABASE_RELEASE_INCOMPATIBLE",
      );
      await assert.rejects(
        () => service.startWhenReady(client, { ...options }, () => {}),
        (e) => e.code === "RUNTIME_ROLE_OVERRIDE_NOT_ALLOWED",
      );
    });
  } finally {
    await backend.end();
  }
  await test("release evidence rejects mutation and legacy migration applied claims", async () => {
    await assert.rejects(
      () =>
        client.query(
          "UPDATE database_release_migrations SET execution_actor='rewritten'",
        ),
      /IMMUTABLE/,
    );
    await assert.rejects(
      () =>
        client.query(
          "INSERT INTO database_release_migrations(migration_id,filename,content_sha256,execution_environment,execution_status,execution_actor,duration_ms,application_release_ref) VALUES('067_canonical_procurement_completion','historical','" +
            "0".repeat(64) +
            "','disposable','APPLIED','test',0,'x')",
        ),
      (e) => e.code === "23514",
    );
  });
  console.log(`Database governance PostgreSQL scenarios passed: ${passed}`);
}
module.exports = { run };
