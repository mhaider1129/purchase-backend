'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createScmRequestInterventionService } = require('../services/scmRequestInterventionService');
module.exports = async client => {
  const fixture = client.connectionParameters;
  assert.equal(fixture.host,'127.0.0.1');
  assert.equal(fixture.user,'p2p_test');
  const schema = 'scm_intervention_fixture';
  const pool = new Pool({ host:fixture.host,port:fixture.port,user:fixture.user,password:fixture.password,database:fixture.database,max:3 });
  const database = { connect:async () => { const connection = await pool.connect(); await connection.query(`SET search_path TO ${schema},public`); return connection; } };
  const actor = { id:1,name:'SCM',role:'SCM',institute_id:7,permissions:['requests.manage'] };
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public;
      CREATE TABLE requests(id int PRIMARY KEY,institute_id int,status text,requester_id int,initiated_by_technician_id int,updated_at timestamptz,completed_at timestamptz,purchase_order_id int,awarded_at timestamptz,po_issued_at timestamptz);
      CREATE TABLE requested_items(id int PRIMARY KEY,request_id int REFERENCES requests(id),purchased_quantity int);
      CREATE TABLE approvals(id int PRIMARY KEY,request_id int REFERENCES requests(id),approver_id int,status text,is_active bool,is_superseded bool DEFAULT false,superseded_at timestamptz,superseded_by_user_id int,superseded_reason text,updated_at timestamptz);
      CREATE TABLE request_logs(id serial PRIMARY KEY,request_id int REFERENCES requests(id),action text,actor_id int,comments text);
      CREATE TABLE approval_logs(approval_id int REFERENCES approvals(id),request_id int,approver_id int,action text,comments text);
      CREATE TABLE audit_logs(action text,action_type text,actor_id int,target_type text,target_id text,description text,details jsonb);
      CREATE TABLE notifications(user_id int,title text,message text,link text,metadata jsonb);
      CREATE TABLE purchase_orders(request_id int);
      CREATE TABLE procurement_item_events(request_id int);
      CREATE TABLE rfx_events(request_id int);
      CREATE TABLE goods_receipts(request_id int);
      CREATE TABLE warehouse_supplied_items(request_id int);
      CREATE TABLE contracts(source_request_id int);
      CREATE TABLE requested_item_financials(request_id int,committed_cost numeric,paid_cost numeric,po_number text,invoice_number text);
      INSERT INTO requests(id,institute_id,status,requester_id) VALUES(208,7,'Submitted',2),(209,7,'Submitted',2),(210,7,'Submitted',2),(211,8,'Submitted',2);
      INSERT INTO requested_items VALUES(363,208,0),(364,209,0),(365,210,0),(366,211,0);
      INSERT INTO approvals(id,request_id,approver_id,status,is_active) VALUES
        (1,208,5,'Approved',false),(2,208,3,'Pending',true),(3,208,4,'On Hold',true),(4,208,1,'Pending',false),
        (5,209,3,'Pending',true),(6,209,1,'Pending',false),(7,210,3,'Pending',true),(8,211,3,'Pending',true);
    `);
    const reject = createScmRequestInterventionService(database);
    const results = await Promise.all([
      reject({ requestId:208,reason:'Incorrect submission',actor }),
      reject({ requestId:208,reason:'Incorrect submission',actor }),
    ]);
    assert.equal(results.filter(result => result.replayed).length,1);
    assert.equal((await client.query('SELECT status FROM requests WHERE id=208')).rows[0].status,'Rejected');
    const approvals = (await client.query('SELECT * FROM approvals WHERE request_id=208 ORDER BY id')).rows;
    assert.equal(approvals[0].status,'Approved');
    assert(approvals.slice(1).every(row => row.status==='Superseded' && row.is_superseded && !row.is_active && row.superseded_by_user_id===1));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM request_logs WHERE request_id=208')).rows[0].n,1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n,1);
    assert.deepEqual((await client.query('SELECT user_id FROM notifications ORDER BY user_id')).rows.map(row => row.user_id),[2,3,4]);
    // Force a real notification insert failure and verify every previous write rolls back.
    await client.query("ALTER TABLE notifications ADD CONSTRAINT fail_fixture_notification CHECK(message NOT LIKE '%request 209 %')");
    await assert.rejects(reject({ requestId:209,reason:'Incorrect submission',actor }));
    assert.equal((await client.query('SELECT status FROM requests WHERE id=209')).rows[0].status,'Submitted');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM approvals WHERE request_id=209 AND is_superseded')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM request_logs WHERE request_id=209')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n,1);
    await client.query('INSERT INTO purchase_orders VALUES(210)');
    await assert.rejects(reject({ requestId:210,reason:'Incorrect submission',actor }), { statusCode:409 });
    await client.query('DELETE FROM purchase_orders WHERE request_id=210');
    await client.query('INSERT INTO requested_item_financials(request_id,paid_cost) VALUES(210,5)');
    await assert.rejects(reject({ requestId:210,reason:'Incorrect submission',actor }), { statusCode:409 });
    await assert.rejects(reject({ requestId:211,reason:'Incorrect submission',actor }), { statusCode:404 });
    console.log('SCM intervention: real atomic rejection, parallel/future-step stopping, prior decision preservation, concurrent retry, notification/audit rollback, downstream/scope guards PASS');
  } finally {
    await pool.end();
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
};
