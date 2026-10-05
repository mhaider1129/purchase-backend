'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { assertDevelopmentTarget, collectBaseline, DEVELOPMENT_PROJECT_REF, TABLES } = require('./lib/p2pBaseline');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/auditP2PBaseline.js [--https] --output /tmp/p2p-development-baseline.json');
    console.log(`Read-only capture restricted to approved development project ${DEVELOPMENT_PROJECT_REF}.`);
    console.log('Requires existing DATABASE_URL and SUPABASE_URL bindings. No .env/app bootstrap imports.');
    console.log('--https uses Python 3 standard-library HTTPS/proxy support for partial metadata/counts only.');
    return;
  }
  const https = args[0] === '--https';
  if (https) args.shift();
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw Object.assign(new Error('Use --help for usage'), { code: 'BASELINE_ARGUMENTS_INVALID' });
  // Refuse wrong-project URLs before creating a Client or creating an output file.
  const target = assertDevelopmentTarget(process.env);
  if (https) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('HTTPS credential binding is required'), { code: 'BASELINE_HTTPS_KEY_MISSING' });
    const child = spawnSync('python3', [path.join(__dirname, 'lib/p2pRestBaseline.py')], {
      input: JSON.stringify({ ...target, tables: TABLES }), encoding: 'utf8',
      timeout: 240000, maxBuffer: 5 * 1024 * 1024,
    });
    if (child.error || child.status !== 0) throw Object.assign(new Error('HTTPS capture failed'), { code: 'BASELINE_HTTPS_FAILED' });
    const report = JSON.parse(child.stdout);
    fs.writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Partial HTTPS metadata/count capture saved; catalog and financial SQL checks remain unverified.');
    process.exitCode = 2;
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 6000,
    application_name: 'p2p-read-only-baseline',
    options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000',
  });
  try {
    await client.connect();
    const report = await collectBaseline(client);
    report.project_ref = target.projectRef;
    // Exclusive creation prevents overwriting a prior capture or following an existing symlink.
    fs.writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Read-only baseline saved. Treat this file as internal diagnostic evidence; do not commit it.');
    console.log(`Capture complete: ${report.capture_complete}; inspect measured/unavailable checks and limitations.`);
    process.exitCode = report.capture_complete ? 0 : 2;
  } finally { await client.end(); }
}

if (require.main === module) main().catch(error => {
  // Never print connection URLs, driver messages, values, or credentials.
  console.error(`Read-only baseline not completed (${error.code || 'UNKNOWN'}). No migration was attempted.`);
  process.exitCode = 1;
});

module.exports = { main };
