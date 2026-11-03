"use strict";
const assert = require("node:assert/strict");
const { disposableDatabaseUrl } = require("./disposableDatabase");
async function run(client, url) {
  process.env.DATABASE_URL = disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  process.env.PGOPTIONS = "-c statement_timeout=10000 -c lock_timeout=5000";
  const pool = require("../config/db");
  const { getFullRequestDetails } = require("../controllers/requests/requestWorkspaceController");
  try {
    await client.query(`
      INSERT INTO institutes(id,name) VALUES(201,'Workspace fixture');
      INSERT INTO departments(id,name,type,institute_id) VALUES(201,'Workspace','Medical',201);
      INSERT INTO users(id,name,email,password,role,institute_id,department_id,is_active)
        VALUES(201,'Requester','workspace@example.invalid','test','custom requester',201,201,true);
      INSERT INTO requests(id,request_type,status,requester_id,department_id,institute_id)
        VALUES(434,'Medical Device','Submitted',201,201,201);
      INSERT INTO requested_items(id,request_id,item_name,quantity,unit_of_measure)
        VALUES(201,434,'Workspace device',3,'Piece');
      INSERT INTO audit_logs(action,target_type,target_id,description)
        VALUES('Request created','request',434,'Request fixture');
    `);
    const call = async (requestId = '434') => {
      const result = { status: 200 };
      await getFullRequestDetails(
        { params: { requestId }, user: { id: 201, role: 'custom requester', institute_id: 201, department_id: 201 } },
        { json(data) { result.data = data; } },
        error => { result.status = error.statusCode; result.error = error.message; },
      );
      return result;
    };
    const result = await call();
    assert.equal(result.status, 200, result.error);
    assert.equal(result.data.request.id, 434);
    assert.equal(result.data.items.length, 1);
    assert.equal(result.data.audit_logs.length, 1);
    assert.equal(result.data.audit_logs[0].action, 'Request created');
    assert(result.data.timeline.some(row => row.event_type === 'audit'));
    assert.deepEqual(result.data.linked_records.contracts, []);
    // Adding contract evidence must not expose it to a requester without finance authority.
    await client.query(`
      INSERT INTO institutes(id,name) VALUES(202,'Other workspace institute');
      INSERT INTO departments(id,name,type,institute_id) VALUES(202,'Other','Medical',202);
      INSERT INTO contracts(id,title,vendor,status,institute_id,end_user_department_id,source_request_id,created_by)
        VALUES(201,'Local contract','Local vendor','draft',201,201,434,201),
              (202,'Foreign contract','Foreign vendor','draft',202,202,NULL,201);
      INSERT INTO audit_logs(action,target_type,target_id,description)
        VALUES('Local contract event','contract',201,'Linked to request 434'),
              ('Foreign contract event','contract',202,'Linked to request 434'),
              ('Library event','contract_library',201,'Linked to request 434');
    `);
    const restricted = await call();
    assert.equal(restricted.status, 200, restricted.error);
    assert.deepEqual(restricted.data.audit_logs.map(row => row.action), ['Request created']);
    await client.query(`INSERT INTO user_permissions(user_id,permission_id)
      SELECT 201,id FROM permissions WHERE code IN ('contracts.manage','procure-to-pay.lifecycle.view')`);
    const authorized = await call();
    assert.equal(authorized.status, 200, authorized.error);
    assert.deepEqual(authorized.data.audit_logs.map(row => row.action).sort(), ['Local contract event','Request created']);
    assert.deepEqual(authorized.data.linked_records.contracts.map(row => row.id), [201]);
    console.log('PASS contract audit visibility: scoped authorized event returned; foreign and library events withheld');
    assert.equal((await call('999999')).status, 404);
    assert.equal((await call('invalid')).status, 400);
    console.log('PASS full-details with native integer audit IDs, requester visibility, timeline, absent request and invalid ID');
  } finally {
    await pool.end();
  }
}
module.exports = { run };
