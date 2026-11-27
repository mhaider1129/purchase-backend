"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { disposableDatabaseUrl } = require("./disposableDatabase");
const {
  managementQueueSql,
} = require("../services/procurementPriority/managementQueueSql");
const {
  activePriorityCaseSql: ACTIVE,
  departmentApprovedRequestSql,
  priorityCaseJoins,
  activeDepartmentRankingSql,
} = require("../services/procurementPriority/activePrioritySql");
// Exact pre-change query oracle; not application code or a migration.
const referenceManagementSql = `SELECT ${departmentApprovedRequestSql} AS department_approved,p.procurement_case_id,p.row_version,pc.department_id,r.id AS request_id,r.status AS request_status,COALESCE(NULLIF(r.maintenance_ref_number,''),r.id::text) AS request_reference,COALESCE(NULLIF(TRIM(p.public_title),''),ri.item_name,'Requirement ' || pc.id::text) AS public_title,d.name AS department_name,dr.department_rank,p.system_score,p.system_tier,p.system_suggested_rank,p.institutional_rank,GREATEST(0,extract(day FROM now()-pc.opened_at))::int AS age,p.impact_level,p.service_risk_level,p.deadline_at,p.deadline_type,pc.case_status,g.public_title AS priority_group_name FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id ${priorityCaseJoins} LEFT JOIN departments d ON d.id=pc.department_id LEFT JOIN (${activeDepartmentRankingSql}) dr ON dr.procurement_case_id=pc.id LEFT JOIN procurement_priority_group_members gm ON gm.procurement_case_id=pc.id AND gm.removed_at IS NULL LEFT JOIN procurement_priority_groups g ON g.id=gm.group_id AND g.status='ACTIVE' WHERE p.institute_id=$1 AND ${ACTIVE} ORDER BY p.institutional_rank NULLS LAST,p.system_suggested_rank NULLS LAST,p.procurement_case_id`;
test("management query preserves results and evaluates completion once per scoped request", async () => {
  const db = new Client({
    connectionString: disposableDatabaseUrl(process.env.P2P_LOCAL_DATABASE_URL),
  });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(`
 CREATE TEMP TABLE requests(id int PRIMARY KEY,institute_id int,department_id int,status text,request_type text DEFAULT 'Medical Device',maintenance_ref_number text);
 CREATE TEMP TABLE requested_items(id int PRIMARY KEY,request_id int,item_name text,approval_status text DEFAULT 'Approved',procurement_status text DEFAULT 'pending');
 CREATE TEMP TABLE users(id int PRIMARY KEY,role text,institute_id int,department_id int);
 CREATE TEMP TABLE approvals(id int PRIMARY KEY,request_id int,approver_id int,status text,is_superseded bool DEFAULT false);
 CREATE TEMP TABLE approval_logs(approval_id int,request_id int,approver_id int,action text,comments text);
 CREATE TEMP TABLE departments(id int PRIMARY KEY,name text);
 CREATE TEMP TABLE procurement_cases(id int PRIMARY KEY,request_id int,requested_item_id int,institute_id int,department_id int,case_status text DEFAULT 'READY_FOR_SOURCING',closed_at timestamptz,opened_at timestamptz DEFAULT '2026-01-01');
 CREATE TEMP TABLE procurement_priority_profiles(procurement_case_id int PRIMARY KEY,institute_id int,row_version int DEFAULT 1,public_title text,system_score numeric DEFAULT 50,system_tier text DEFAULT 'P3',system_suggested_rank int,institutional_rank int,impact_level text,service_risk_level text,deadline_at timestamptz,deadline_type text);
 CREATE TEMP TABLE department_priority_rankings(procurement_case_id int,department_rank int,valid_until timestamptz);
 CREATE TEMP TABLE request_priority_rankings(request_id int PRIMARY KEY,institute_id int,department_id int,department_rank int);
 CREATE TEMP TABLE procurement_priority_groups(id int PRIMARY KEY,institute_id int,public_title text,status text);
 CREATE TEMP TABLE procurement_priority_group_members(group_id int,procurement_case_id int,removed_at timestamptz);
 CREATE TEMP TABLE completion_facts(request_id int PRIMARY KEY,institute_id int,stock bool,fulfilled bool,items jsonb);
 CREATE TEMP TABLE completion_calls(request_id int,institute_id int);
 INSERT INTO users VALUES(901,'HOD',7,9),(902,'HOD',7,10),(903,'HOD',8,20);
 INSERT INTO departments VALUES(9,'D9'),(10,'D10'),(20,'Foreign');
 INSERT INTO requests(id,institute_id,department_id,status) VALUES(1,7,9,'Approved'),(2,7,9,'Completed'),(3,7,10,'Approved'),(4,7,9,'Approved'),(5,7,10,'Submitted'),(7,7,9,'Approved'),(8,7,9,'Approved'),(9,7,9,'Approved'),(10,7,9,'Approved');
 UPDATE requests SET request_type='Warehouse Supply' WHERE id=9;
 INSERT INTO requests(id,institute_id,department_id,status) SELECT n,8,20,'Approved' FROM generate_series(100,140)n;
 INSERT INTO requested_items(id,request_id,item_name) SELECT id*10,id,'Item '||id FROM requests;
 INSERT INTO requested_items VALUES(11,1,'Second item','Approved','pending'),(41,4,'Rejected item','Rejected','pending'),(42,4,'Purchased item','Approved','purchased');
 INSERT INTO procurement_cases(id,request_id,requested_item_id,institute_id,department_id) SELECT ri.id,ri.request_id,ri.id,r.institute_id,r.department_id FROM requested_items ri JOIN requests r ON r.id=ri.request_id;
 UPDATE procurement_cases SET case_status='DELIVERED' WHERE request_id=8;
 UPDATE procurement_cases SET closed_at=now() WHERE request_id=10;
 INSERT INTO procurement_priority_profiles(procurement_case_id,institute_id,public_title,institutional_rank) SELECT id,institute_id,'Case '||id,id FROM procurement_cases;
 INSERT INTO approvals(id,request_id,approver_id,status) SELECT id,id,CASE WHEN institute_id=8 THEN 903 WHEN department_id=10 THEN 902 ELSE 901 END,'Approved' FROM requests WHERE id<>5;
 INSERT INTO approvals VALUES(500,5,902,'Approved',true);
 INSERT INTO department_priority_rankings SELECT id,id,NULL FROM procurement_cases;
 INSERT INTO request_priority_rankings VALUES(4,7,9,1);
 INSERT INTO procurement_priority_groups VALUES(1,7,'Group A','ACTIVE'),(2,7,'Group B','ACTIVE');
 INSERT INTO procurement_priority_group_members VALUES(1,10,NULL),(2,10,NULL),(1,40,now());
 INSERT INTO completion_facts SELECT r.id,r.institute_id,r.id=3,r.id=7,jsonb_agg(jsonb_build_object('requested_item_id',ri.id::text,'stock_resolved',r.id=3)) FROM requests r JOIN requested_items ri ON ri.request_id=r.id GROUP BY r.id,r.institute_id;
 CREATE FUNCTION public.canonical_procurement_completion(p_request_id integer,p_institute_id integer,p_item_id integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $fixture$
 DECLARE f record; result jsonb; BEGIN
 INSERT INTO pg_temp.completion_calls VALUES(p_request_id,p_institute_id);
 SELECT * INTO f FROM pg_temp.completion_facts WHERE request_id=p_request_id AND institute_id=p_institute_id;
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM jsonb_array_elements(f.items)x WHERE p_item_id IS NULL OR (x->>'requested_item_id')::int=p_item_id;
 RETURN jsonb_build_object('stock_resolved',f.stock,'fulfillment_complete',f.fulfilled,'items',result);
 END $fixture$;
 `);
    const old = (await db.query(referenceManagementSql, [7])).rows;
    const oldCalls = (
      await db.query("SELECT count(*)::int n FROM completion_calls")
    ).rows[0].n;
    assert(
      (
        await db.query(
          "SELECT 1 FROM completion_calls WHERE institute_id=8 LIMIT 1",
        )
      ).rowCount > 0,
    );
    await db.query("TRUNCATE completion_calls");
    const current = (await db.query(managementQueueSql, [7])).rows;
    const currentCalls = (
      await db.query("SELECT count(*)::int n FROM completion_calls")
    ).rows[0].n;
    const order = (rows) =>
      [...rows].sort(
        (a, b) =>
          a.procurement_case_id - b.procurement_case_id ||
          String(a.priority_group_name).localeCompare(
            String(b.priority_group_name),
          ),
      );
    assert.deepEqual(order(current), order(old));
    assert.deepEqual(
      [...new Set(current.map((r) => r.request_id))].sort((a, b) => a - b),
      [1, 4, 5, 9],
    );
    assert(
      current
        .filter((r) => r.request_id === 5)
        .every(
          (r) => r.department_approved === false && r.department_rank === null,
        ),
    );
    assert.equal(
      (await db.query("SELECT 1 FROM completion_calls WHERE institute_id<>7"))
        .rowCount,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM completion_calls GROUP BY request_id HAVING count(*)>1",
        )
      ).rowCount,
      0,
    );
    assert(oldCalls > currentCalls);
    assert.equal(currentCalls, 6);
    console.log(
      JSON.stringify({
        syntheticCompletionEvaluations: {
          before: oldCalls,
          after: currentCalls,
        },
        productionLatencyVerified: false,
      }),
    );
    // A partially stock-resolved request must retain its other outstanding item.
    await db.query(
      `UPDATE completion_facts SET items=jsonb_set(items,'{0,stock_resolved}','true'::jsonb) WHERE request_id=1`,
    );
    const partialOld = (await db.query(referenceManagementSql, [7])).rows;
    const partialNew = (await db.query(managementQueueSql, [7])).rows;
    assert.deepEqual(order(partialNew), order(partialOld));
    assert(partialNew.some((r) => r.procurement_case_id === 11));
    assert(!partialNew.some((r) => r.procurement_case_id === 10));
    await db.query(
      "UPDATE procurement_priority_profiles SET institute_id=8 WHERE procurement_case_id=40",
    );
    assert(
      !(await db.query(managementQueueSql, [7])).rows.some(
        (r) => r.procurement_case_id === 40,
      ),
    );
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
test("management transaction deadline rolls back and does not leak to later pooled work", async () => {
  const db = new Client({
    connectionString: disposableDatabaseUrl(process.env.P2P_LOCAL_DATABASE_URL),
  });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    await db.query("SET LOCAL statement_timeout='20ms'");
    await assert.rejects(
      db.query("SELECT pg_sleep(0.1)"),
      (e) => e.code === "57014",
    );
    await db.query("ROLLBACK");
    assert.equal(
      (await db.query("SHOW statement_timeout")).rows[0].statement_timeout,
      "0",
    );
    assert.equal(
      (await db.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only,
      "off",
    );
  } finally {
    await db.end();
  }
});
