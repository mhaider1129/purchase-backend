'use strict';
// Uses only a runner-created loopback Docker database. Never reads DATABASE_URL.
const fs=require('fs'),crypto=require('crypto'),{execFileSync}=require('child_process');
const {Client}=require('pg');
const assert = require('node:assert/strict');
const path = require('path');
const { extractBackendSqlContract } = require('./extractBackendSqlContract');
const {disposableDatabaseUrl}=require('../integration/disposableDatabase');
const root=path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const contract=JSON.parse(read('docs/database-audit/backend-contract.json'));
const knownFailures=JSON.parse(read('docs/database-audit/known-query-failures.json'));
const verifyMissing = async client => {
  for (const [table, columns] of Object.entries(contract.requiredColumns)) {
    const actual=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table])).rows.map(r=>r.column_name);
    for(const column of columns) assert(actual.includes(column), `Missing ${table}.${column}`);
  }
};
async function validatePreservation(client) {
  const query = (sql, args) => client.query(sql, args);
  const schemaPatch = read('sql/manual/035_backend_schema_reconciliation.sql');
  const permissionsPatch = read('sql/manual/036_permission_catalog_reconciliation.sql');
  const uiPatch = read('sql/manual/037_ui_resource_reconciliation.sql');
  const existingUser = (await query("SELECT to_jsonb(u)-'updated_at' AS value FROM users u WHERE id=1")).rows[0].value;
  const oldCatalog = (await query("SELECT id,code,name,description FROM permissions ORDER BY id")).rows;
  const grantsBefore = (await query("SELECT 'role' AS type,role_id AS subject,permission_id FROM role_permissions UNION ALL SELECT 'user',user_id,permission_id FROM user_permissions ORDER BY 1,2,3")).rows;
  await query("UPDATE ui_resource_permissions SET permissions=ARRAY['item-master.references-maintain'],require_all=true WHERE resource_key='feature.itemMaster'");
  const uiBefore = (await query('SELECT * FROM ui_resource_permissions ORDER BY resource_key')).rows;
  await query("SELECT setval('public.permissions_id_seq',9000,true)");
  await query("UPDATE procurement_identity_policy SET enforce_item_identity=false,reason='Preserve rollout choice' WHERE id=1");
  await query("SELECT setval('public.purchase_order_number_seq',950000,true)");
  await query("INSERT INTO generic_items(item_code,generic_name,canonical_description,category,item_type,base_uom,inventory_uom,structured_fingerprint) VALUES ('AUDIT-DRAFT','Audit draft','Audit draft','Test only','general_item','EA','EA','audit-fingerprint')");
  await query("INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,stock_status,lot_number) VALUES (1,1,'Legacy stock',2,'AVAILABLE','audit-lot'),(1,1,'Legacy stock',3,'QUARANTINE','audit-lot')");
  await assert.rejects(query("INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,stock_status,lot_number) VALUES (1,1,'Legacy stock',1,'AVAILABLE','audit-lot')"), e=>e.code==='23505');
  await query("INSERT INTO inventory_transactions(transaction_type,movement_type,stock_item_id,quantity,idempotency_key) VALUES ('ISSUE','ISSUE',1,1,'audit-posted-immutable')");
  await assert.rejects(query("UPDATE inventory_transactions SET quantity=2 WHERE idempotency_key='audit-posted-immutable'"), /immutable/);
  await assert.rejects(query("DELETE FROM inventory_transactions WHERE idempotency_key='audit-posted-immutable'"), /immutable/);
  for (let pass=0;pass<2;pass++) {
    await query(schemaPatch);
    await query(permissionsPatch);
    await query(uiPatch);
  }
  assert.deepEqual((await query("SELECT to_jsonb(u)-'updated_at' AS value FROM users u WHERE id=1")).rows[0].value, existingUser);
  const oldIds = oldCatalog.map(r=>r.id);
  assert.deepEqual((await query('SELECT id,code,name,description FROM permissions WHERE id=ANY($1::integer[]) ORDER BY id',[oldIds])).rows,oldCatalog);
  assert.deepEqual((await query('SELECT * FROM ui_resource_permissions ORDER BY resource_key')).rows,uiBefore);
  assert.deepEqual((await query("SELECT 'role' AS type,role_id AS subject,permission_id FROM role_permissions UNION ALL SELECT 'user',user_id,permission_id FROM user_permissions ORDER BY 1,2,3")).rows,grantsBefore);
  assert.equal((await query("SELECT count(*)::integer AS n FROM permissions WHERE code=ANY($1::text[])",[contract.missingPermissions])).rows[0].n,6);
  assert((await query("SELECT last_value::integer AS n FROM permissions_id_seq")).rows[0].n>=9000);
  assert.equal((await query("SELECT last_value::integer AS n FROM purchase_order_number_seq")).rows[0].n,950000);
  assert.equal((await query('SELECT enforce_item_identity FROM procurement_identity_policy WHERE id=1')).rows[0].enforce_item_identity,false);
  assert.deepEqual((await query("SELECT lifecycle_status,is_active FROM generic_items WHERE item_code='AUDIT-DRAFT'")).rows[0],{lifecycle_status:'draft',is_active:false});
  await query("INSERT INTO item_uom(uom_code,uom_name) VALUES ('AUDIT-EA','Audit Each')");
  assert.equal((await query("SELECT name FROM item_uom WHERE uom_code='AUDIT-EA'")).rows[0].name,'Audit Each');
  await query("UPDATE item_uom SET uom_name='Audit Each updated' WHERE uom_code='AUDIT-EA'");
  assert.equal((await query("SELECT name FROM item_uom WHERE uom_code='AUDIT-EA'")).rows[0].name,'Audit Each updated');
  const modules=Object.keys(contract.missingTables);
  assert.equal((await query("SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity",[modules])).rows[0].n,modules.length);
  // Grant table access locally to prove RLS itself still prevents bypassing backend authorization.
  await query('CREATE ROLE audit_browser; GRANT USAGE ON SCHEMA public TO audit_browser; GRANT SELECT,INSERT ON generic_items TO audit_browser; SET ROLE audit_browser');
  try {
    assert.equal((await query('SELECT count(*)::integer AS n FROM generic_items')).rows[0].n,0);
    await assert.rejects(query("INSERT INTO generic_items(id,item_code,generic_name,canonical_description,category,item_type,base_uom,inventory_uom,structured_fingerprint) VALUES (9999,'BYPASS','Bypass','Bypass','Test','general_item','EA','EA','bypass')"), e=>e.code==='42501');
  } finally { await query('RESET ROLE'); }
}

async function validateEvaluationResultTimestamps(client, historicalRow) {
  const metadataPatch=read('sql/manual/038_evaluation_result_timestamp_compatibility.sql');
  const values=async()=> (await client.query("SELECT to_jsonb(r)-'created_at'-'updated_at' AS value FROM procurement_evaluation_results r ORDER BY id")).rows.map(row=>row.value);
  assert.deepEqual((await values())[0],historicalRow);
  const before=(await client.query('SELECT created_at,updated_at FROM procurement_evaluation_results WHERE id=$1',[historicalRow.id])).rows[0];
  assert.deepEqual(before,{created_at:null,updated_at:null});
  await client.query('INSERT INTO procurement_evaluation_results(tco_period_cost,final_weighted_score,compliance_passed) VALUES (4321.25,75.125,false)');
  const future=(await client.query('SELECT created_at,updated_at FROM procurement_evaluation_results WHERE id<>$1',[historicalRow.id])).rows[0];
  assert(future.created_at instanceof Date && future.updated_at instanceof Date);
  const originalValues=await values();
  // Local Docker fixture only: reproduce the reported legacy schema for SQL 038.
  await client.query('ALTER TABLE procurement_evaluation_results DROP COLUMN created_at, DROP COLUMN updated_at');
  await client.query(metadataPatch);
  await client.query(metadataPatch);
  assert.deepEqual(await values(),originalValues);
  assert.equal((await client.query('SELECT count(*)::integer AS n FROM procurement_evaluation_results WHERE created_at IS NOT NULL OR updated_at IS NOT NULL')).rows[0].n,0);
  const columns=(await client.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_results' AND column_name IN ('created_at','updated_at') ORDER BY column_name")).rows;
  assert.equal(columns.length,2);
  for(const column of columns) { assert.equal(column.is_nullable,'YES'); assert(column.column_default); }
  // Existing timestamp values and customized defaults must not be rewritten.
  await client.query("UPDATE procurement_evaluation_results SET created_at='2020-01-02T03:04:05Z',updated_at='2020-02-03T04:05:06Z' WHERE id=$1",[historicalRow.id]);
  await client.query("ALTER TABLE procurement_evaluation_results ALTER COLUMN created_at SET DEFAULT '2021-01-01T00:00:00Z'::timestamptz");
  const snapshot=(await client.query('SELECT * FROM procurement_evaluation_results ORDER BY id')).rows;
  const defaults=(await client.query("SELECT column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_results' AND column_name IN ('created_at','updated_at') ORDER BY column_name")).rows;
  await client.query(metadataPatch);
  await client.query(read('sql/manual/035_backend_schema_reconciliation.sql'));
  assert.deepEqual((await client.query('SELECT * FROM procurement_evaluation_results ORDER BY id')).rows,snapshot);
  assert.deepEqual((await client.query("SELECT column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_results' AND column_name IN ('created_at','updated_at') ORDER BY column_name")).rows,defaults);
  console.log('Populated evaluation results: metadata repair, preservation, defaults and repeat checks PASS');
}

async function validateEvaluationOfferModels(client, historicalOffer) {
  const modelFields=contract.nullableCompatibilityColumns.procurement_evaluation_offers;
  const compatibilityPatch=read('sql/manual/039_evaluation_offer_model_compatibility.sql');
  const values=async()=> (await client.query('SELECT to_jsonb(o)-$1::text[] AS value FROM procurement_evaluation_offers o ORDER BY id',[modelFields])).rows.map(row=>row.value);
  assert.deepEqual((await values())[0],historicalOffer);
  const historical=(await client.query('SELECT * FROM procurement_evaluation_offers WHERE id=$1',[historicalOffer.id])).rows[0];
  for(const field of modelFields) assert.equal(historical[field],null);
  await client.query("INSERT INTO procurement_evaluation_offers(offer_name,device_price,is_compliant,is_disqualified) VALUES ('New offer',2345.67,false,true)");
  const future=(await client.query('SELECT * FROM procurement_evaluation_offers WHERE id<>$1',[historicalOffer.id])).rows[0];
  for(const field of modelFields) assert.deepEqual(future[field],{});
  const originalValues=await values();
  // Disposable Docker fixture only: reproduce missing legacy JSON fields for standalone SQL 039.
  for(const field of modelFields) await client.query(`ALTER TABLE procurement_evaluation_offers DROP COLUMN ${field}`);
  await client.query(compatibilityPatch);
  await client.query(compatibilityPatch);
  assert.deepEqual(await values(),originalValues);
  const repaired=(await client.query('SELECT * FROM procurement_evaluation_offers ORDER BY id')).rows;
  for(const row of repaired) for(const field of modelFields) assert.equal(row[field],null);
  const columns=(await client.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_offers' AND column_name=ANY($1::text[]) ORDER BY column_name",[modelFields])).rows;
  assert.equal(columns.length,6);
  for(const column of columns) { assert.equal(column.data_type,'jsonb'); assert.equal(column.is_nullable,'YES'); assert(column.column_default); }
  // Supplied model payloads are stored, and existing models/defaults survive retries.
  await client.query('UPDATE procurement_evaluation_offers SET service_model=$1::jsonb WHERE id=$2',[{contract_kind:'maintenance',supplier_term:'retain existing data'},historicalOffer.id]);
  await client.query(`ALTER TABLE procurement_evaluation_offers ALTER COLUMN service_model SET DEFAULT '{"custom":true}'::jsonb`);
  const snapshot=(await client.query('SELECT * FROM procurement_evaluation_offers ORDER BY id')).rows;
  const defaults=(await client.query("SELECT column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_offers' AND column_name=ANY($1::text[]) ORDER BY column_name",[modelFields])).rows;
  await client.query(compatibilityPatch);
  await client.query(read('sql/manual/035_backend_schema_reconciliation.sql'));
  assert.deepEqual((await client.query('SELECT * FROM procurement_evaluation_offers ORDER BY id')).rows,snapshot);
  assert.deepEqual((await client.query("SELECT column_name,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='procurement_evaluation_offers' AND column_name=ANY($1::text[]) ORDER BY column_name",[modelFields])).rows,defaults);
  // The optional-model exception must not permit invented historical offer prices.
  await client.query('BEGIN; ALTER TABLE procurement_evaluation_offers DROP COLUMN device_price');
  await assert.rejects(client.query(read('sql/manual/035_backend_schema_reconciliation.sql')), /Populated partial module procurement_evaluation_offers.device_price/);
  await client.query('ROLLBACK');
  assert.deepEqual((await client.query('SELECT * FROM procurement_evaluation_offers ORDER BY id')).rows,snapshot);
  console.log('Populated offers: JSON compatibility, preservation, writes, defaults and financial guard checks PASS');
}

async function run() {
  const name = `p2p_disposable_${crypto.randomBytes(8).toString('hex')}`;
  const password = crypto.randomBytes(24).toString('hex');
  let container;
  let client;
  try {
    container = execFileSync('docker', [
      'run', '--detach', '--rm', '--tmpfs', '/var/lib/postgresql/data:rw',
      '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=p2p_test', '--env', `POSTGRES_DB=${name}`,
      'postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67',
    ], { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } }).trim();
    const address = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
    const url = disposableDatabaseUrl(`postgresql://p2p_test:${password}@${address}/${name}`);
    let connected = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      client = new Client({ connectionString: url });
      try { await client.connect(); connected = true; break; }
      catch (_) { await client.end(); await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert(connected, 'Disposable PostgreSQL did not become ready');
    for (const [file, expected] of Object.entries(contract.snapshots)) {
      assert.equal(crypto.createHash('sha256').update(read('sql/' + file)).digest('hex'), expected,
        'Snapshot changed; re-audit before updating fixture: ' + file);
    }
    const snapshot = JSON.parse(read('integration/fixtures/supabaseSchemaBaseline.json'));
    const context = read('sql/View_Supabase_SQL.sql');
    let baseline = '';
    for (const match of context.matchAll(/nextval\('([^']+)'/g)) {
      baseline += `CREATE SEQUENCE IF NOT EXISTS ${match[1]};\n`;
    }
    for (const [table, body] of Object.entries(snapshot)) {
      // Export placeholders are normalized only in this fixture. FK targets are missing
      // in the export, so references are restored after module-table creation below.
      const normalized = body.replace(/\bARRAY(?=\s+NOT NULL)/g, 'text[]')
        .replace(/,\s*CONSTRAINT\s+\w+\s+FOREIGN KEY\s*\([^)]*\)\s+REFERENCES\s+public\.\w+\s*\([^)]*\)/gi, '');
      baseline += `CREATE TABLE public.${table} (${normalized});\n`;
    }
    await client.query(baseline);
    await client.query(read('sql/permissions_Table.sql'));
    await client.query(read('sql/UI_resource_permissions.sql').replace(/ARRAY\[\]/g, 'ARRAY[]::text[]'));
    console.log(`Snapshot fixture created: ${Object.keys(snapshot).length} tables`);
    await client.query(`
      INSERT INTO users(id,name,email,password,role) VALUES (1,'Existing user','audit@example.invalid','test-only-hash','Auditor');
      INSERT INTO roles(id,name) VALUES (1,'Audit preservation role');
      INSERT INTO role_permissions(role_id,permission_id) SELECT 1,id FROM permissions ORDER BY id LIMIT 1;
      INSERT INTO user_permissions(user_id,permission_id) SELECT 1,id FROM permissions ORDER BY id LIMIT 1;
      INSERT INTO warehouses(id,name) VALUES (1,'Existing warehouse');
      INSERT INTO stock_items(id,name) VALUES (1,'Existing stock');
      CREATE UNIQUE INDEX audit_legacy_wsl_key ON warehouse_stock_levels(warehouse_id,stock_item_id,batch_id,lot_number,expiry_date,serial_number);
    `);
    const verificationSql = read('sql/manual/035_backend_schema_reconciliation_verify.sql');
    const initial = (await client.query(verificationSql)).rows;
    const count = name => initial.find(row=>row.check_name===name).finding_count;
    assert.equal(count('missing_tables'), Object.keys(contract.missingTables).length);
    assert.equal(count('missing_permissions'), 6);
    assert.equal(count('missing_ui_resources'), 0);
    const patch = read('sql/manual/035_backend_schema_reconciliation.sql');
    // The deployed backend stores complete financial results without metadata timestamps.
    const resultsCreate=patch.match(/CREATE TABLE IF NOT EXISTS public\.procurement_evaluation_results \([\s\S]*?\n\);/)[0];
    await client.query(resultsCreate.replace(/^  (?:created_at|updated_at) timestamptz.*\n/gm,''));
    await client.query("INSERT INTO procurement_evaluation_results(tco_period_cost,final_weighted_score,compliance_passed,knockout_failed,scoring_breakdown) VALUES (12345.67,63.125,false,true,'{\"test\":\"preserve historical result\"}')");
    const historicalResult=(await client.query('SELECT to_jsonb(r) AS value FROM procurement_evaluation_results r')).rows[0].value;
    const offersCreate=patch.match(/CREATE TABLE IF NOT EXISTS public\.procurement_evaluation_offers \([\s\S]*?\n\);/)[0];
    const modelPattern=new RegExp('^  (?:'+contract.nullableCompatibilityColumns.procurement_evaluation_offers.join('|')+') jsonb.*\\n','gm');
    await client.query(offersCreate.replace(modelPattern,''));
    await client.query("INSERT INTO procurement_evaluation_offers(offer_name,pricing_model,device_price,minimum_annual_commitment_amount,is_compliant,is_disqualified,created_at,updated_at) VALUES ('Historical offer','PURCHASE',24680.12,10000,false,true,'2019-01-02T03:04:05Z','2020-02-03T04:05:06Z')");
    const historicalOffer=(await client.query('SELECT to_jsonb(o) AS value FROM procurement_evaluation_offers o')).rows[0].value;

    // Prove that populated partial modules stop before inferred/default historical values.
    await client.query("BEGIN; CREATE TABLE public.generic_items(id bigint PRIMARY KEY,item_code text); INSERT INTO public.generic_items VALUES (1,'partial-existing');");
    await assert.rejects(client.query(patch), /Populated partial module generic_items/);
    await client.query('ROLLBACK');
    assert.equal((await client.query("SELECT to_regclass('public.generic_items') AS relation")).rows[0].relation,null);
    await client.query(patch);
    console.log('Schema patch first application PASS');
    // Restore all context-export references now that missing targets exist, without
    // replacing constraints already installed by the patch.
    for (const [table, body] of Object.entries(snapshot)) {
      for (const match of body.matchAll(/CONSTRAINT\s+(\w+)\s+FOREIGN KEY\s*\([^)]*\)\s+REFERENCES\s+public\.\w+\s*\([^)]*\)/gi)) {
        const exists = (await client.query('SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname=$2', ['public.' + table, match[1]])).rowCount;
        if (!exists) await client.query(`ALTER TABLE public.${table} ADD ${match[0]} NOT VALID`);
      }
    }
    await client.query(patch);
    console.log('Schema patch repeat application PASS');
    await validateEvaluationResultTimestamps(client,historicalResult);
    await validateEvaluationOfferModels(client,historicalOffer);
    await validatePreservation(client);
    await verifyMissing(client);
    const postflight = (await client.query(verificationSql)).rows;
    for (const result of postflight.filter(row=>row.category==='missing_or_invalid')) {
      assert.equal(result.finding_count,0,JSON.stringify(result));
    }
    for (const view of Object.keys(contract.views)) {
      const { rows } = await client.query('SELECT reloptions FROM pg_class WHERE oid=to_regclass($1)', ['public.' + view]);
      assert(rows[0].reloptions.includes('security_invoker=true'));
    }
    console.log('Preservation, authorization, contract and read-only verification checks PASS');
    const failures = [];
    const passed = [];
    for (const row of extractBackendSqlContract(root).sql) {
      const sql = row.value.trim();
      if (!row.queryCall || sql.includes('${') || !/^(SELECT|WITH|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(sql) || /;\s*\S/.test(sql)) continue;
      const count = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
      try {
        await client.query('EXPLAIN ' + sql, new Array(count).fill(null));
        passed.push({ source: row.source, line: row.line });
      } catch (error) {
        failures.push({ source: row.source, line: row.line, code: error.code, message: error.message });
      }
    }
    const key = row => `${row.source}:${row.line}:${row.code}`;
    const expected = new Set(knownFailures.map(key));
    const unexpected = failures.filter(row => !expected.has(key(row)));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
    console.log(`Known pre-existing query failures: ${failures.length}; unexpected failures: ${unexpected.length}`);
    console.log(JSON.stringify({ plansPassed: passed.length, plansFailed: failures.length }));
    for (const row of failures) console.log(`${row.source}:${row.line} ${row.code} ${row.message}`);
  } finally {
    if (client) await client.end();
    if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
