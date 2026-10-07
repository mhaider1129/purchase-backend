'use strict';
const assert = require('node:assert/strict');

// Called only by the guarded disposable PostgreSQL runner. Extract SQL without
// importing app services or their configured database connections.
module.exports = async function validateBackendQueryCompatibility(client, literals) {
  const sql = (source, fragment) => {
    const matches = literals.filter(row=>row.queryCall && row.source===source && row.value.includes(fragment));
    assert.equal(matches.length,1,`Expected one backend query: ${source} ${fragment}`);
    return matches[0].value;
  };
  const run = (source, fragment, params) => client.query(sql(source,fragment),params);
  await client.query('BEGIN');
  try {
    // Preserve production column types/defaults. FK/trigger orchestration belongs
    // to service tests; these isolated fixtures test parameter binding and outcomes.
    for (const table of ['approvals','inventory_reservations','pending_item_requests','asset_inventory_findings','asset_tags','rfid_read_events','rfid_portal_antennas','rfid_portals','audit_logs']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
    }
    await client.query("INSERT INTO public.requests(id,request_type,status) VALUES (991,'Non-Stock','Approved')");
    await client.query("INSERT INTO public.requested_items(id,request_id,item_name,quantity,purchased_quantity,unit_cost,total_cost) VALUES (991,991,'Overage parameter test',1,1,511766,511766)");
    const overageSql=sql('controllers/requests/procurementItemEventsController.js','UPDATE public.requested_items SET purchased_quantity = $1, unit_cost');
    await client.query('SAVEPOINT overage_reproduction');
    const legacyOverageSql=overageSql.replace('$2::numeric','$2').replace('$3::numeric','$3');
    await assert.rejects(client.query(legacyOverageSql,[2,'310000.00','620000.00',1,991]),error=>error.code==='22P02');
    await client.query('ROLLBACK TO SAVEPOINT overage_reproduction');
    const repaired=(await client.query(overageSql,[2,'310000.00','620000.00',1,991])).rows[0];
    assert.equal(repaired.purchased_quantity,2);
    assert.equal(repaired.unit_cost,'310000');
    assert.equal(repaired.total_cost,'620000');
    // Also preserve cents on installations with decimal item-cost columns.
    await client.query('CREATE TEMP TABLE overage_decimal_items (LIKE public.requested_items INCLUDING DEFAULTS)');
    await client.query('ALTER TABLE overage_decimal_items ALTER COLUMN unit_cost TYPE numeric(14,2), ALTER COLUMN total_cost TYPE numeric(14,2)');
    await client.query("INSERT INTO overage_decimal_items(id,request_id,item_name,quantity,purchased_quantity) VALUES (991,991,'Decimal cost test',1,1)");
    const decimal=(await client.query(overageSql.replace('public.requested_items','pg_temp.overage_decimal_items'),[2,'511765.76','1023531.52',1,991])).rows[0];
    assert.equal(decimal.unit_cost,'511765.76');
    assert.equal(decimal.total_cost,'1023531.52');
    console.log('Reproduced overage decimal-string/bigint failure (22P02); explicit numeric casts PASS');
    for (const sent of [true,false]) {
      const row=(await run('controllers/requests/centralSupplyChainController.js','SET sent_to_central_supply_at',[sent,1,991])).rows[0];
      assert.equal(row.sent_to_central_supply_by,sent?1:null);
      assert.equal(row.sent_to_central_supply_at instanceof Date,sent);
    }
    await client.query("INSERT INTO approvals(id,status,is_active) VALUES (991,'Pending',true)");
    for (const decision of ['Approved','Rejected']) {
      await client.query("UPDATE approvals SET status='Pending',is_active=true WHERE id=991");
      const row=(await run('services/approvalEngine.js','UPDATE approvals SET status=',[decision,'verified',991])).rows[0];
      assert.equal(row.status,decision); assert.equal(row.is_active,false);
      assert.equal(row.approved_at instanceof Date,decision==='Approved');
      assert.equal(row.rejected_at instanceof Date,decision==='Rejected');
      assert(row.decided_at instanceof Date);
    }
    assert.equal((await run('services/approvalEngine.js','UPDATE approvals SET status=',['Approved','repeat',991])).rowCount,0);
    await client.query("INSERT INTO inventory_reservations(id,warehouse_id,stock_item_id,document_type,document_id,quantity,status,idempotency_key,created_by) VALUES (991,1,1,'REQUEST','991',3,'ACTIVE','query-test',1)");
    for (const complete of [false,true]) {
      await run('services/inventoryReservationService.js','UPDATE inventory_reservations SET consumed_quantity',[991,complete?3:1,complete,1]);
      const row=(await client.query('SELECT * FROM inventory_reservations WHERE id=991')).rows[0];
      assert.equal(row.status,complete?'CONSUMED':'ACTIVE'); assert.equal(row.consumed_by,complete?1:null);
      assert.equal(row.consumed_at instanceof Date,complete);
    }
    await client.query("INSERT INTO pending_item_requests(id,proposed_name,item_type,intended_use,justification,requester_id) VALUES (991,'Test','general_item','Test only','Test only',1)");
    for (const status of ['needs_information','resolved']) {
      const row=(await run('services/itemMasterFoundationService.js','UPDATE pending_item_requests SET status=',[991,status,status==='resolved'?'existing_generic':'needs_information',null,null,'verified',1])).rows[0];
      assert.equal(row.status,status); assert.equal(row.resolved_by,status==='resolved'?1:null);
      assert.equal(row.resolved_at instanceof Date,status==='resolved');
    }
    await client.query("INSERT INTO asset_inventory_findings(id,institute_id,session_id,finding_type,created_by) VALUES (991,1,1,'WRONG_LOCATION',1)");
    for (const status of ['ACKNOWLEDGED','RESOLVED','DISMISSED']) {
      const row=(await run('services/physicalInventoryService.js','UPDATE asset_inventory_findings SET status=$1',[status,1,'CHECKED','verified',991])).rows[0];
      assert.equal(row.status,status); assert.equal(row.acknowledged_by,1); assert(row.acknowledged_at instanceof Date);
      assert.equal(row.resolved_by,status==='ACKNOWLEDGED'?null:1);
    }
    for (const status of ['ACTIVE','PENDING_ENCODING']) {
      const row=(await run('services/rfidService.js','qr_value,tag_status,is_primary,installed_at',[1,1,'RFID_UHF','QUERY'+status,null,null,status,true,1,'Test only'])).rows[0];
      assert.equal(row.tag_status,status); assert.equal(row.installed_at instanceof Date,status==='ACTIVE');
      const retired=(await run('services/rfidService.js','UPDATE asset_tags SET tag_status=$1',['RETIRED',1,'verified',row.id])).rows[0];
      assert.equal(retired.tag_status,'RETIRED'); assert.equal(retired.retired_by,1); assert(retired.retired_at instanceof Date);
    }
    await client.query("INSERT INTO rfid_read_events(id,institute_id,integration_client_id,epc,reader_id,read_timestamp,source_type) VALUES (991,1,1,'QUERY-EPC',1,now(),'TEST')");
    const read=(await run('services/rfidEventProcessor.js','SELECT r.*,pa.direction_role',[991])).rows[0];
    assert.equal(read.id,'991'); assert.equal(read.direction_role,null); assert.equal(read.portal_from_location_id,null);
    for (const status of ['technical_inspection_pending','completed']) {
      await run('utils/technicalInspectionStatus.js','SET status =',[status,991]);
      const row=(await client.query('SELECT status,completed_at FROM public.requests WHERE id=991')).rows[0];
      assert.equal(row.status,status); assert.equal(row.completed_at instanceof Date,status==='completed');
    }
    await client.query("UPDATE public.requests SET status='Received' WHERE id=991");
    assert.equal((await run('utils/technicalInspectionStatus.js','SET status =',['completed',991])).rowCount,0);
    await run('controllers/requestedItems/updateProcurementStatusController.js','INSERT INTO audit_logs',[1,991,'Test status change']);
    const audit=(await client.query('SELECT user_id,actor_id,target_id,details FROM audit_logs')).rows[0];
    assert.deepEqual(audit,{user_id:1,actor_id:1,target_id:991,details:'Test status change'});
    console.log('Executed all 10 repaired backend queries: parameter types, actors, timestamps, guarded writes, canonical audit and nullable RFID joins PASS');
  } finally {
    await client.query('ROLLBACK');
  }
};
