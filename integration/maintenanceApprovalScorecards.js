'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Executed only inside the runner-created disposable PostgreSQL database.
module.exports = async (client) => {
  const source = fs.readFileSync(path.join(__dirname, '../controllers/requests/fetchRequestsController.js'), 'utf8');
  const controller = source.slice(source.indexOf('const getMyMaintenanceRequests ='));
  const end = controller.indexOf("), '[]'::json) AS current_pending_approvals");
  const start = controller.lastIndexOf('COALESCE((', end);
  assert(start >= 0 && end > start);
  const expression = controller.slice(start, end) + "), '[]'::json)";
  await client.query(`CREATE TEMP TABLE users(id integer PRIMARY KEY, name text, role text);
    CREATE TEMP TABLE approvals(id integer PRIMARY KEY, request_id integer, approval_level integer,
      approver_id integer, status text, is_active boolean, is_superseded boolean);
    INSERT INTO users VALUES (1,'Clinical executive','CMO'),(2,'Operations executive','COO');
    INSERT INTO approvals VALUES
      (1,1,5,1,'Pending',TRUE,FALSE),
      (2,1,8,2,'Pending',TRUE,NULL),
      (3,1,1,1,'Pending',FALSE,FALSE),
      (4,1,2,1,'Pending',TRUE,TRUE),
      (5,1,3,1,'Approved',TRUE,FALSE),
      (6,1,9,NULL,'Pending',TRUE,FALSE);`);
  try {
    const { rows } = await client.query(`SELECT r.id, ${expression} AS pending FROM (VALUES (1),(2)) r(id) ORDER BY r.id`);
    assert.deepEqual(rows[0].pending.map((row) => row.approval_id), [1, 2, 6]);
    assert.deepEqual(rows[0].pending.map((row) => row.approver_role), ['CMO', 'COO', null]);
    assert.deepEqual(rows[1].pending, []);
    console.log('Maintenance pending scorecards: actual SQL excludes future/superseded/approved steps; parallel and missing-holder rows retained PASS');
  } finally {
    await client.query('DROP TABLE pg_temp.approvals; DROP TABLE pg_temp.users');
  }
};
