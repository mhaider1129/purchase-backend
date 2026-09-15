'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { Client } = require('pg');

const sql028 = fs.readFileSync(path.join(__dirname, '../sql/manual/028_asset_movement_operational_hardening.sql'), 'utf8');
const sql029 = fs.readFileSync(path.join(__dirname, '../sql/manual/029_fixed_asset_deployment_valuation.sql'), 'utf8');
const url = process.env.SQL028_029_LOCAL_DATABASE_URL;

function isLocalDisposable(value) {
  if (!value || /supabase/i.test(value)) return false;
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  const host = parsed.hostname;
  return ['postgres:', 'postgresql:'].includes(parsed.protocol)
    && (host === 'localhost' || (net.isIP(host) === 4 && host.startsWith('127.')) || host === '::1')
    && /^sql028_029_disposable_[a-z0-9_]*$/i.test(parsed.pathname.slice(1));
}

if (!isLocalDisposable(url)) {
  console.error('LOCAL_DB_UNAVAILABLE');
  process.exitCode = 2;
  return;
}

const client = new Client({ connectionString: url });
const baseFixture = `
  DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  CREATE TABLE sections(id integer PRIMARY KEY);
  CREATE TABLE assets(id bigserial PRIMARY KEY,institute_id integer NOT NULL,currency char(3));
  CREATE TABLE asset_movements(
    id bigserial PRIMARY KEY,institute_id integer NOT NULL,asset_id bigint NOT NULL REFERENCES assets(id),
    movement_type varchar(40) NOT NULL CONSTRAINT asset_movements_movement_type_check CHECK(movement_type IN(
      'PERMANENT_TRANSFER','TEMPORARY_LOAN','MAINTENANCE_TRANSFER','EXTERNAL_MAINTENANCE','RETURN',
      'STORAGE_TRANSFER','DISPOSAL_TRANSFER','LOCATION_CORRECTION')),
    status varchar(30) NOT NULL
  );
`;
async function reset() { await client.query(baseFixture); }
async function rejects(sql, marker) {
  try { await client.query(sql); } catch (error) {
    if (error.message.includes(marker)) return;
    throw error;
  }
  throw new Error(`Expected failure containing ${marker}`);
}
async function noticeOnSecondRun(sql, marker) {
  await client.query(sql);
  let seen = false;
  const listener = notice => { if (notice.message === marker) seen = true; };
  client.on('notice', listener);
  await client.query(sql);
  client.off('notice', listener);
  if (!seen) throw new Error(`Expected notice ${marker}`);
}
async function installed028() { await client.query(sql028); }
async function installed029() { await installed028(); await client.query(sql029); }

(async () => {
  await client.connect();
  try {
    // SQL 028 clean install and exact compatible re-run.
    await reset(); await noticeOnSecondRun(sql028, 'SQL_028_ALREADY_APPLIED_COMPATIBLE');

    await reset();
    await client.query("INSERT INTO assets(institute_id) VALUES(1); INSERT INTO asset_movements(institute_id,asset_id,movement_type,status) VALUES(1,1,'PERMANENT_TRANSFER','APPROVED'),(1,1,'TEMPORARY_LOAN','IN_TRANSIT')");
    await rejects(sql028, 'SQL_028_ACTIVE_MOVEMENT_CONFLICT');

    await reset(); await client.query('ALTER TABLE asset_movements ADD COLUMN origin_movement_id bigint');
    await rejects(sql028, 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028();
    await client.query('ALTER TABLE asset_movements DROP CONSTRAINT asset_movements_origin_movement_id_fkey; ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_origin_movement_id_fkey FOREIGN KEY(origin_movement_id) REFERENCES assets(id)');
    await rejects(sql028, 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028();
    await client.query("DROP INDEX asset_movements_one_active_uq; CREATE UNIQUE INDEX asset_movements_one_active_uq ON asset_movements(institute_id,asset_id) WHERE status IN('APPROVED','IN_TRANSIT')");
    await rejects(sql028, 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028();
    await client.query("DROP INDEX asset_movements_return_origin_uq; CREATE UNIQUE INDEX asset_movements_return_origin_uq ON asset_movements(origin_movement_id) WHERE movement_type='TEMPORARY_LOAN'");
    await rejects(sql028, 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028();
    await client.query("ALTER TABLE asset_movements DROP CONSTRAINT asset_movements_return_origin_ck; ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_return_origin_ck CHECK(movement_type<>'RETURN' OR origin_movement_id IS NOT NULL)");
    await rejects(sql028, 'SQL_028_PARTIAL_OR_DRIFTED_SCHEMA');

    // SQL 029 clean install, compatible re-run, canonical movement type, and lossless backfill.
    await reset(); await installed028();
    await client.query("INSERT INTO assets(institute_id,currency) VALUES(1,'USD'),(1,NULL)");
    await noticeOnSecondRun(sql029, 'SQL_029_ALREADY_APPLIED_COMPATIBLE');
    const backfill = await client.query('SELECT currency,acquisition_currency FROM assets ORDER BY id');
    if (backfill.rows[0].acquisition_currency !== 'USD' || backfill.rows[1].acquisition_currency !== null) throw new Error('SQL 029 currency backfill was not lossless');
    await client.query("INSERT INTO asset_movements(institute_id,asset_id,movement_type,status) VALUES(1,1,'INITIAL_DEPLOYMENT','RECEIVED')");

    // PostgreSQL can deparse the same varchar IN check with text array casts.
    // That catalog representation is compatible and must not be reported as drift.
    await reset(); await installed028();
    await client.query(`ALTER TABLE asset_movements DROP CONSTRAINT asset_movements_movement_type_check;
      ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_movement_type_check CHECK(movement_type::text = ANY(ARRAY[
        'PERMANENT_TRANSFER'::text,'TEMPORARY_LOAN'::text,'MAINTENANCE_TRANSFER'::text,
        'EXTERNAL_MAINTENANCE'::text,'RETURN'::text,'STORAGE_TRANSFER'::text,
        'DISPOSAL_TRANSFER'::text,'LOCATION_CORRECTION'::text]))`);
    await client.query(sql029);

    awa
    await rejects(sql029, 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028(); await client.query('ALTER TABLE assets ADD COLUMN responsible_section_id bigint');
    await rejects(sql029, 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed029();
    await client.query('ALTER TABLE assets DROP CONSTRAINT assets_responsible_section_id_fkey; ALTER TABLE assets ADD CONSTRAINT assets_responsible_section_id_fkey FOREIGN KEY(responsible_section_id) REFERENCES assets(id)');
    await rejects(sql029, 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed029();
    await client.query('ALTER TABLE assets DROP CONSTRAINT assets_exchange_rate_positive_ck; ALTER TABLE assets ADD CONSTRAINT assets_exchange_rate_positive_ck CHECK(exchange_rate_to_iqd IS NULL OR exchange_rate_to_iqd>=0)');
    await rejects(sql029, 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA');

    await reset(); await installed028();
    await client.query("ALTER TABLE asset_movements DROP CONSTRAINT asset_movements_movement_type_check; ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_movement_type_check CHECK(movement_type IN('PERMANENT_TRANSFER','RETURN'))");
    await rejects(sql029, 'SQL_029_PARTIAL_OR_DRIFTED_SCHEMA');

    console.log('SQL_028_029_LOCAL_INTEGRATION_OK');
  } finally { await client.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });