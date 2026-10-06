'use strict';

const { DEVELOPMENT_PROJECT_REF: ref, TABLES, CHECKS, CATALOG_QUERIES,
  assertDevelopmentTarget, missingColumns, collectBaseline } = require('../scripts/lib/p2pBaseline');

const bindings = () => ({ SUPABASE_URL: `https://${ref}.supabase.co`,
  DATABASE_URL: `postgresql://postgres.${ref}:test@aws-1-eu-central-1.pooler.supabase.com:5432/postgres` });

test('accepts only the confirmed development project and its direct/pooler endpoints', () => {
  expect(assertDevelopmentTarget(bindings()).projectRef).toBe(ref);
  expect(assertDevelopmentTarget({ ...bindings(), DATABASE_URL: `postgresql://postgres:test@db.${ref}.supabase.co:5432/postgres` }).projectRef).toBe(ref);
});

test.each([
  { SUPABASE_URL: 'https://another.supabase.co' },
  { DATABASE_URL: 'postgresql://postgres.another:test@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' },
  { DATABASE_URL: `postgresql://postgres.${ref}:test@malicious.example:5432/postgres` },
  { DATABASE_URL: bindings().DATABASE_URL + '?sslmode=disable' },
  { SUPABASE_URL: `https://${ref}.supabase.co/path` },
  { DATABASE_URL: undefined },
])('rejects wrong projects and connection overrides before any network call: %p', overrides => {
  expect(() => assertDevelopmentTarget({ ...bindings(), ...overrides })).toThrow();
});

test('queries use fixed SELECTs and identifiers; no arbitrary SQL or application bootstrap', () => {
  for (const sql of [...Object.values(CATALOG_QUERIES), ...CHECKS.map(check => check.sql)]) {
    expect(sql.trim()).toMatch(/^SELECT\b/);
    expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|nextval\s*\(|setval\s*\()/i);
  }
  expect(TABLES.every(table => /^[a-z_]+$/.test(table))).toBe(true);
  expect(missingColumns([{ table_name: 'a', column_name: 'id' }], { a: ['id','other'] })).toEqual(['a.other']);
});

function fakeClient({ readOnly = 'on', failScan = false, failCatalog = false } = {}) {
  const columns = [...new Set(CHECKS.flatMap(check => Object.entries(check.requires)
    .flatMap(([table, names]) => names.map(column => `${table}.${column}`))))]
    .map(name => { const [table_name, column_name] = name.split('.'); return { table_name, column_name }; });
  const query = jest.fn(async sql => {
    if (sql.includes('current_user database_role')) return { rows: [{ transaction_read_only: readOnly }] };
    for (const [name, catalog] of Object.entries(CATALOG_QUERIES)) if (sql === catalog) {
      if (failCatalog && name === 'columns') throw Object.assign(new Error('denied'), { code: '42501' });
      return { rows: name === 'columns' ? columns : name === 'relations' ? TABLES.map(table_name => ({table_name,relation_kind:'r'})) : [] };
    }
    if (sql.startsWith('SELECT COUNT')) {
      if (failScan) throw Object.assign(new Error('timeout with sensitive detail'), { code: '57014' });
      return { rows: [{ candidate_count: '0', row_count: '0' }] };
    }
    return { rows: [] };
  });
  return { query };
}

test('captures queries in one read-only snapshot and always rolls it back', async () => {
  const client = fakeClient();
  const result = await collectBaseline(client);
  expect(client.query.mock.calls[0][0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(result.capture_complete).toBe(true);
  expect(Object.keys(result.checks)).toHaveLength(CHECKS.length);
});

test('refuses a transaction that is not read-only before inspecting data', async () => {
  const client = fakeClient({readOnly:'off'});
  await expect(collectBaseline(client)).rejects.toMatchObject({code:'BASELINE_NOT_READ_ONLY'});
  expect(client.query.mock.calls).toHaveLength(3);
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('missing schema is unavailable rather than a passing zero-count result', async () => {
  const client = { query: jest.fn(async sql => ({rows:sql.includes('current_user database_role') ? [{transaction_read_only:'on'}] : []})) };
  const result = await collectBaseline(client);
  expect(result.capture_complete).toBe(false);
  expect(result.checks.cross_source_supplier_bill_candidates.status).toBe('unavailable');
  expect(result.checks.cross_source_supplier_bill_candidates).not.toHaveProperty('rows');
  expect(result.row_counts.contract_payments.status).toBe('missing_relation');
});

test('recoverable query failure preserves the snapshot and redacts sensitive driver messages', async () => {
  const client = fakeClient({failScan:true});
  const result = await collectBaseline(client);
  expect(result.capture_complete).toBe(false);
  expect(result.checks.cross_source_supplier_bill_candidates).toEqual({status:'unavailable',error_code:'57014'});
  expect(JSON.stringify(result)).not.toContain('sensitive');
  expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK TO SAVEPOINT baseline_scan')).toBe(true);
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('fatal catalog failure also rolls back instead of returning partial success', async () => {
  const client = fakeClient({failCatalog:true});
  await expect(collectBaseline(client)).rejects.toMatchObject({code:'42501'});
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

async function runCli({ env = bindings(), result = {status:0,stdout:'{"capture_complete":false}'}, expectError = null } = {}) {
  const fs = require('node:fs');
  const childProcess = require('node:child_process');
  const write = jest.spyOn(fs,'writeFileSync').mockImplementation(() => {});
  const spawn = jest.spyOn(childProcess,'spawnSync').mockReturnValue(result);
  const log = jest.spyOn(console,'log').mockImplementation(() => {});
  const originalArgs = process.argv, originalEnv = process.env, originalExitCode = process.exitCode;
  process.argv = ['node','auditP2PBaseline.js','--https','--output','/tmp/test-baseline.json'];
  process.env = {...originalEnv,...env,SUPABASE_SERVICE_ROLE_KEY:'test-only-key'};
  try {
    let main;
    jest.isolateModules(() => { main = require('../scripts/auditP2PBaseline').main; });
    if (expectError) await expect(main()).rejects.toMatchObject({code:expectError});
    else await main();
    return { writes:write.mock.calls, spawns:spawn.mock.calls, logs:log.mock.calls, exitCode:process.exitCode };
  } finally {
    process.argv = originalArgs; process.env = originalEnv; process.exitCode = originalExitCode;
    write.mockRestore(); spawn.mockRestore(); log.mockRestore();
  }
}

test('CLI refuses the wrong project before spawning HTTPS helper or saving evidence', async () => {
  const result = await runCli({env:{...bindings(),SUPABASE_URL:'https://another.supabase.co'},expectError:'BASELINE_PROJECT_MISMATCH'});
  expect(result.spawns).toHaveLength(0);
  expect(result.writes).toHaveLength(0);
});

test('HTTPS CLI stores partial evidence privately and never passes credentials on the command line', async () => {
  const result = await runCli();
  expect(result.exitCode).toBe(2);
  expect(result.spawns[0][0]).toBe('python3');
  expect(result.spawns[0][2].input).not.toContain('test-only-key');
  expect(result.spawns[0][2].input).not.toContain('postgresql');
  expect(result.writes[0][2]).toEqual({flag:'wx',mode:0o600});
});

test('HTTPS subprocess failure does not save a report or expose its raw error', async () => {
  const result = await runCli({result:{status:1,stdout:'secret details',stderr:'secret details'},expectError:'BASELINE_HTTPS_FAILED'});
  expect(result.writes).toHaveLength(0);
  expect(JSON.stringify(result.logs)).not.toContain('secret details');
});
