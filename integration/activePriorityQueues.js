'use strict';
const assert = require('node:assert/strict');
const { createProcurementPriorityRepository } = require('../repositories/procurementPriorityRepository');
const { activeDepartmentRankingSql } = require('../services/procurementPriority/activePrioritySql');

module.exports = async (client) => {
  // Only runner-created loopback PostgreSQL, never the configured application DB.
  assert.equal(client.connectionParameters.host, '127.0.0.1');
  assert.equal(client.connectionParameters.user, 'p2p_test');
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TEMP TABLE requests(id int,status text,maintenance_ref_number text) ON COMMIT DROP;
      CREATE TEMP TABLE requested_items(id int,request_id int,item_name text,approval_status text,procurement_status text) ON COMMIT DROP;
      CREATE TEMP TABLE departments(id int,name text) ON COMMIT DROP;
      CREATE TEMP TABLE procurement_cases(id bigint,request_id int,requested_item_id int,institute_id int,department_id int,case_status text,closed_at timestamptz,opened_at timestamptz DEFAULT now()) ON COMMIT DROP;
      CREATE TEMP TABLE procurement_priority_profiles(procurement_case_id bigint,institute_id int,is_public bool DEFAULT true,public_title text,public_description text,system_score numeric,system_tier text,system_suggested_rank int,institutional_rank int,row_version int DEFAULT 1,impact_level text,service_risk_level text,deadline_at timestamptz,deadline_type text) ON COMMIT DROP;
      CREATE TEMP TABLE department_priority_rankings(procurement_case_id bigint,department_rank int,department_rank_total int,valid_until timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE procurement_priority_groups(id int PRIMARY KEY,institute_id int,is_public bool,status text,public_title text,public_description text,tier_override text,institutional_rank int,created_at timestamptz DEFAULT now()) ON COMMIT DROP;
      CREATE TEMP TABLE procurement_priority_group_members(group_id int,procurement_case_id bigint,removed_at timestamptz) ON COMMIT DROP;
      INSERT INTO requests VALUES(1,'Approved','R1'),(2,' completed ','R2'),(3,'Closed','R3'),(4,'Partially Procured','R4'),(5,'Approved','R5'),(6,'Approved','R6'),(7,'Received','R7');
      INSERT INTO requested_items SELECT id+100,id,'Item '||id,'Approved',CASE WHEN id=5 THEN 'purchased' ELSE 'pending' END FROM requests;
      INSERT INTO procurement_cases(id,request_id,requested_item_id,institute_id,department_id,case_status) SELECT id+10,id,id+100,7,9,CASE WHEN id=6 THEN 'DELIVERED' ELSE 'READY_FOR_SOURCING' END FROM requests;
      INSERT INTO procurement_priority_profiles(procurement_case_id,institute_id,public_title,system_score,system_tier,institutional_rank) SELECT id,7,'Case '||id,50,'P3',id-10 FROM procurement_cases;
      INSERT INTO department_priority_rankings SELECT id,id::int-10,7,NULL FROM procurement_cases;
      INSERT INTO procurement_priority_groups(id,institute_id,is_public,status,public_title,institutional_rank) VALUES(1,7,true,'ACTIVE','Mixed group',8),(2,7,true,'ACTIVE','Completed group',9),(3,7,true,'ACTIVE','Empty group',10);
      INSERT INTO procurement_priority_group_members VALUES(1,11,NULL),(1,12,NULL),(2,12,NULL);
    `);
    const repo = createProcurementPriorityRepository(client);
    assert.deepEqual((await repo.managementQueue(7)).map(row => Number(row.procurement_case_id)), [11,14]);
    const department = await repo.departmentQueue(7,9);
    assert.deepEqual(department.map(row => [Number(row.procurement_case_id),row.department_rank,row.department_rank_total]), [[11,1,2],[14,2,2]]);
    assert.equal((await repo.profile(14,7)).department_rank,2);
    assert.equal((await repo.profile(14,7)).department_rank_total,2);
    // PostgreSQL must support locking outer profiles/cases with the windowed rank projection.
    const lockedRanks = await client.query(`SELECT p.procurement_case_id,d.department_rank_total FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id LEFT JOIN (${activeDepartmentRankingSql}) d ON d.procurement_case_id=pc.id WHERE p.procurement_case_id=14 FOR UPDATE OF p,pc`);
    assert.equal(lockedRanks.rows[0].department_rank_total,2);
    const publicRows = await repo.publicQueue(7);
    assert.equal(publicRows.length,3);
    assert.equal(publicRows.find(row => row.is_group).member_count,1);
    assert.equal(publicRows.find(row => row.is_group).public_title,'Mixed group');
    const groups = await repo.groups(7);
    assert.deepEqual(groups.map(row => row.member_count),[1,0,0]);
    assert.deepEqual(groups[0].member_case_ids.map(Number),[11]);
    assert.deepEqual(await repo.departmentQueue(8,9),[]);
    assert.deepEqual(await repo.publicQueue(8),[]);
    // A completion is reflected immediately, even though closed_at stays NULL.
    await client.query("UPDATE requests SET status='Completed' WHERE id=1");
    assert.equal((await repo.managementQueue(7)).length,1);
    assert.deepEqual((await repo.departmentQueue(7,9)).map(row => [row.department_rank,row.department_rank_total]),[[1,1]]);
    assert.equal((await repo.profile(14,7)).department_rank,1);
    assert.equal((await repo.profile(14,7)).department_rank_total,1);
    assert.equal((await repo.publicQueue(7)).length,1);
    assert.equal((await repo.groups(7))[0].member_count,0);
    await assert.rejects(repo.reorderDepartment({ instituteId:7, departmentId:9, orderedCaseIds:[11,14], version:1, actorId:1, client }), { statusCode:409 });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM procurement_priority_profiles')).rows[0].count,7);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM department_priority_rankings')).rows[0].count,7);
    console.log('Active priority queues: immediate completion exclusion, case/item terminals, active group counts, normalized department ranks, stale reorder rejection and history preservation PASS');
  } finally { await client.query('ROLLBACK'); }
};
