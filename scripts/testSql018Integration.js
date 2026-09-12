'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { Client } = require('pg');

const migration = fs.readFileSync(path.join(__dirname, '../sql/manual/018_fixed_assets_rfid_post_deployment_hardening.sql'), 'utf8');
const url = process.env.SQL018_LOCAL_DATABASE_URL;

function localDisposableUrl(value) {
  if (!value) return false;
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  const localHost = parsed.hostname === 'localhost' || net.isIP(parsed.hostname) === 4 && parsed.hostname.startsWith('127.');
  return ['postgres:', 'postgresql:'].includes(parsed.protocol)
    && localHost
    && parsed.pathname.slice(1).startsWith('sql018_disposable_')
    && !/supabase/i.test(value);
}

if (!localDisposableUrl(url)) {
  console.error('LOCAL_DB_UNAVAILABLE');
  process.exitCode = 2;
  return;
}

const client = new Client({ connectionString: url });
const fixture = `
  DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  CREATE TABLE institutes(id integer PRIMARY KEY);
  CREATE TABLE asset_number_allocators(id bigint); CREATE TABLE asset_categories(id bigint);
  CREATE TABLE asset_locations(id bigint); CREATE TABLE asset_movements(id bigint);
  CREATE TABLE asset_tags(id bigint); CREATE TABLE rfid_integration_clients(id bigint);
  CREATE TABLE rfid_read_events(id bigint); CREATE TABLE rfid_business_events(id bigint);
  CREATE TABLE asset_exceptions(id bigint);
  CREATE TABLE assets(id bigint PRIMARY KEY,current_location_id bigint,responsible_department_id integer);
  CREATE TABLE custody_records(id bigint PRIMARY KEY,asset_id bigint);
  CREATE TABLE rfid_readers(id bigint PRIMARY KEY,institute_id integer NOT NULL);
  CREATE TABLE rfid_antennas(id bigint PRIMARY KEY,institute_id integer NOT NULL,reader_id bigint NOT NULL REFERENCES rfid_readers(id));
  CREATE TABLE rfid_portals(id bigint PRIMARY KEY,institute_id integer NOT NULL,enabled boolean NOT NULL);
  CREATE TABLE rfid_portal_antennas(portal_id bigint NOT NULL REFERENCES rfid_portals(id),antenna_id bigint NOT NULL REFERENCES rfid_antennas(id),PRIMARY KEY(portal_id,antenna_id));
`;

async function reset() { await client.query(fixture); }
async function rejects(sql, marker) {
  try { await client.query(sql); } catch (error) {
    if (error.message.includes(marker)) return;
    throw error;
  }
  throw new Error(`Expected failure containing: ${marker}`);
}
async function seed() {
  await client.query(`INSERT INTO institutes VALUES(1),(2);
    INSERT INTO rfid_readers VALUES(10,1),(20,2);
    INSERT INTO rfid_antennas VALUES(100,1,10),(200,2,20);
    INSERT INTO rfid_portals VALUES(1000,1,true),(1001,1,true),(1002,1,false),(2000,2,true);`);
}

async function concurrency(enabledAtStart) {
  await reset(); await seed(); await client.query(migration);
  if (!enabledAtStart) {
    await client.query('UPDATE rfid_portals SET enabled=false WHERE id IN (1000,1001)');
    await client.query('INSERT INTO rfid_portal_antennas VALUES(1000,100),(1001,100)');
  }
  const a = new Client({ connectionString: url }); const b = new Client({ connectionString: url });
  await Promise.all([a.connect(), b.connect()]);
  try {
    await Promise.all([a.query('BEGIN'), b.query('BEGIN')]);
    const statements = enabledAtStart
      ? [a.query('INSERT INTO rfid_portal_antennas VALUES(1000,100)'), b.query('INSERT INTO rfid_portal_antennas VALUES(1001,100)')]
      : [a.query('UPDATE rfid_portals SET enabled=true WHERE id=1000'), b.query('UPDATE rfid_portals SET enabled=true WHERE id=1001')];
    const settled = await Promise.allSettled(statements.map((operation, index) => operation.then(() => [a, b][index].query('COMMIT'))));
    await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]);
    if (settled.filter(x => x.status === 'fulfilled').length !== 1) throw new Error('Concurrent operations did not serialize to exactly one winner');
  } finally { await Promise.all([a.end(), b.end()]); }
  const result = await client.query(`SELECT count(*)::int AS n FROM rfid_portal_antennas pa JOIN rfid_portals p ON p.id=pa.portal_id WHERE pa.antenna_id=100 AND p.enabled`);
  if (result.rows[0].n !== 1) throw new Error('Concurrency invariant violated');
}

(async () => {
  await client.connect();
  try {
    // Clean installation and compatible no-op (capturing the required notice).
    await reset(); await client.query(migration);
    let noticed = false; client.on('notice', n => { if (n.message === 'SQL_018_ALREADY_APPLIED_COMPATIBLE') noticed = true; });
    await client.query(migration); if (!noticed) throw new Error('Compatible re-run did not emit required notice');

    await reset(); await client.query('CREATE FUNCTION enforce_rfid_portal_antenna_scope() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$');
    await rejects(migration, 'SQL_018_PARTIAL_OR_DRIFTED_SCHEMA');
    await reset(); await client.query(migration);
    await client.query(`CREATE OR REPLACE FUNCTION enforce_rfid_portal_antenna_scope() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`);
    await rejects(migration, 'SQL_018_PARTIAL_OR_DRIFTED_SCHEMA');
    await reset(); await client.query(migration); await client.query('ALTER TABLE rfid_portal_antennas DISABLE TRIGGER rfid_portal_antenna_scope_guard');
    await rejects(migration, 'SQL_018_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await seed(); await client.query(migration);
    await client.query('INSERT INTO rfid_portal_antennas VALUES(1000,100)');
    await rejects('INSERT INTO rfid_portal_antennas VALUES(2000,100)', 'same institute');
    await client.query('UPDATE rfid_readers SET institute_id=2 WHERE id=10');
    await rejects('INSERT INTO rfid_portal_antennas VALUES(1002,100)', 'reader must belong');
    await client.query('UPDATE rfid_readers SET institute_id=1 WHERE id=10');
    await rejects('INSERT INTO rfid_portal_antennas VALUES(1001,100)', 'another enabled portal');
    await client.query('INSERT INTO rfid_portal_antennas VALUES(1002,100)'); // Disabled sharing is intentional.
    await rejects('UPDATE rfid_portals SET enabled=true WHERE id=1002', 'another enabled portal');
    await client.query('INSERT INTO assets VALUES(1,77,88); INSERT INTO custody_records VALUES(1,1); INSERT INTO asset_movements VALUES(1)');
    await client.query('UPDATE rfid_portals SET enabled=false WHERE id=1000');
    const untouched = await client.query(`SELECT a.current_location_id,a.responsible_department_id,
      (SELECT count(*)::int FROM custody_records) custody,(SELECT count(*)::int FROM asset_movements) movements FROM assets a WHERE id=1`);
    if (JSON.stringify(untouched.rows[0]) !== JSON.stringify({current_location_id:'77',responsible_department_id:88,custody:1,movements:1})) throw new Error('Integrity trigger mutated asset state');

    await concurrency(true); await concurrency(false);
    console.log('SQL_018_LOCAL_INTEGRATION_OK');
    console.log('SQL_018_CONCURRENCY_OK');
  } finally { await client.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });