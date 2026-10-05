'use strict';

const crypto = require('crypto');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { Client } = require('pg');
const { disposableDatabaseUrl } = require('../integration/disposableDatabase');

const IMAGE = 'postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67';
let container;
const cleanup = () => {
  if (!container) return;
  const result = spawnSync('docker', ['rm', '--force', container], { stdio: 'pipe' });
  container = null;
  if (result.status !== 0) {
    console.error('Failed to remove the integration test container');
    process.exitCode = process.exitCode || 1;
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); });
}

async function main() {
  const name = `p2p_disposable_${crypto.randomBytes(8).toString('hex')}`;
  const password = crypto.randomBytes(24).toString('hex');
  // Docker receives only these explicit POSTGRES_* variables and no mounted
  // datasets. The test process's DATABASE_URL is replaced with the local URL.
  container = execFileSync('docker', ['run', '--detach', '--rm',
    '--label', 'purchase-tracker.p2p-integration=true',
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=p2p_test',
    '--env', `POSTGRES_DB=${name}`, IMAGE,
  ], { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } }).trim();
  const address = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Test container is not bound exclusively to loopback');
  const url = disposableDatabaseUrl(`postgresql://p2p_test:${password}@${address}/${name}`);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await client.connect(); await client.query('SELECT 1'); ready = true; }
    catch (_) { /* PostgreSQL may still be initializing. */ }
    finally { await client.end(); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  console.log('Running P2P integration tests against isolated PostgreSQL 16');
  const result = spawnSync(process.execPath, ['--test', path.resolve(__dirname, '../integration/p2p.postgres.test.js')], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, P2P_LOCAL_DATABASE_URL: url },
    timeout: 120000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
