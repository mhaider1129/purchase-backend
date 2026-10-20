'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

module.exports=async(client)=>{
  assert.equal(client.connectionParameters.host,'127.0.0.1');
  assert.equal(client.connectionParameters.user,'p2p_test');
  const patch=fs.readFileSync(path.join(__dirname,'../sql/manual/048_approval_hold_adjusted_timing.sql'),'utf8');
  await client.query(patch);
  await client.query(patch);
  const rights=(await client.query("SELECT prosecdef,provolatile,EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid='public.approval_active_elapsed_seconds(bigint,timestamptz,timestamptz)'::regprocedure")).rows[0];
  assert.deepEqual(rights,{prosecdef:false,provolatile:'s',public_execute:false});
  const pool=require('../config/db');
  const originalQuery=pool.query;
  pool.query=(...args)=>client.query(...args);
  const dashboard=require('../controllers/dashboardController');
  await client.query('BEGIN');
  try {
    const base=(await client.query("SELECT now()-interval '100 days' AS value")).rows[0].value;
    const at=day=>new Date(base.getTime()+day*86400000);
    const request=(await client.query("INSERT INTO public.requests(request_type,status,created_at,updated_at) VALUES('Stock','Approved',$1,$2) RETURNING id",[at(0),at(98)])).rows[0];
    const a=(await client.query("INSERT INTO public.approvals(request_id,approver_id,approval_level,status,is_active,approved_at,updated_at) VALUES($1,1,1,'Approved',false,$2::timestamptz,$2::timestamptz) RETURNING id",[request.id,at(98)])).rows[0];
    const b=(await client.query("INSERT INTO public.approvals(request_id,approver_id,approval_level,status,is_active,approved_at,updated_at) VALUES($1,1,2,'Approved',false,$2::timestamptz,$2::timestamptz) RETURNING id",[request.id,at(50)])).rows[0];
    await client.query("INSERT INTO public.purchase_orders(request_id,status,created_at) VALUES($1,'PO_ISSUED',$2)",[request.id,at(100)]);
    const log=(approvalId,action,day)=>client.query('INSERT INTO public.approval_logs(approval_id,request_id,approver_id,action,timestamp,created_at) VALUES($1,$2,1,$3,$4,$4)',[approvalId,request.id,action,at(day)]);
    const days=async(start=0,end=100,id=request.id)=>Number((await client.query('SELECT public.approval_active_elapsed_seconds($1,$2,$3)/86400 AS days',[id,start==null?null:at(start),end==null?null:at(end)])).rows[0].days);
    const invoke=async(method)=>{
      let result;
      const res={json:value=>{result=value;},status:code=>{throw new Error(`Dashboard returned ${code}`);}};
      await dashboard[method]({user:{hasPermission:()=>true},query:{}},res);
      assert(result);return result;
    };
    const before=await invoke('getDashboardSummary');
    assert.equal(await days(),100);
    await log(a.id,'On Hold',5);await log(a.id,'Resumed',95);
    assert.equal(await days(),10,'90-day hold must not inflate a 100-day PR-to-PO clock');
    await log(b.id,'On Hold',10);await log(b.id,'Approved',50);
    await log(a.id,'On Hold',6); // duplicate state event inside the same hold
    await log(a.id,'Reminder sent',80); // not a state transition
    assert.equal(await days(),10,'parallel/duplicate holds are counted only once');
    await log(a.id,'On Hold',96);await log(a.id,'Resumed',97);await log(a.id,'Approved',98);
    assert.equal(await days(),9,'multiple hold cycles accumulate');
    assert.equal(await days(90,100),4,'only the overlapping portion is removed');
    assert.equal(await days(7,8),0,'fully-held windows clamp to zero');
    assert.equal(await days(0,4),4,'future holds do not affect an earlier milestone');
    assert.equal(await days(0,100,request.id+99999),100,'other requests cannot contaminate timing');
    const invalid=await client.query('SELECT public.approval_active_elapsed_seconds($1,NULL,$2) AS missing,public.approval_active_elapsed_seconds($1,$2,$3) AS reversed',[request.id,at(100),at(0)]);
    assert.deepEqual(invalid.rows[0],{missing:null,reversed:null});
    const history=(await client.query('SELECT * FROM public.approval_logs WHERE request_id=$1 ORDER BY id',[request.id])).rows;
    // Reapply the same DDL inside this fixture's transaction without its outer
    // transaction wrappers, so test data still rolls back at the end.
    await client.query(patch.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
    assert.deepEqual((await client.query('SELECT * FROM public.approval_logs WHERE request_id=$1 ORDER BY id',[request.id])).rows,history);
    const lifecycle=await invoke('getLifecycleAnalytics');
    assert.equal(lifecycle.avg_pr_to_po_cycle_days,9);
    assert.equal(lifecycle.avg_pr_to_final_approval_days,7);
    assert.deepEqual(lifecycle.stage_durations,[{stage:1,avg_days:7},{stage:2,avg_days:5}]);
    const summary=await invoke('getDashboardSummary');
    assert.equal(summary.avg_approval_time_days,7);
    for(const key of ['total_requests','approved_requests','pending_requests','completed_requests']) assert.equal(summary[key],before[key]);
    assert.deepEqual(summary.spending_by_month,before.spending_by_month);
    await client.query("UPDATE public.requests SET status='Pending' WHERE id=$1",[request.id]);
    await client.query("UPDATE public.approvals SET status='Pending',is_active=true,approved_at=NULL WHERE request_id=$1",[request.id]);
    const pending=await invoke('getDashboardSummary');
    assert(Math.abs(pending.avg_pending_age_days-9)<1e-6);
    assert(Math.abs(pending.oldest_pending_requests[0].age_days-9)<1e-6);
    assert.equal(pending.pending_aging_buckets.find(row=>row.bucket==='8-14 days').request_count,1);
    await client.query("UPDATE public.approvals SET status='On Hold',updated_at=$2 WHERE id=$1",[a.id,at(99)]);
    await log(a.id,'On Hold',99);
    assert.equal(await days(),8,'open holds run to the metric cutoff');
    assert.equal(await days(0,101),8,'an open hold freezes active elapsed time');
    const workload=await invoke('getWorkloadAnalysis');
    assert(Math.abs(workload.avg_age_days-8)<1e-6);
    assert(workload.workload_by_level.every(row=>Math.abs(row.avg_age_days-8)<1e-6));
    // A current hold without a log has only its known state timestamp available.
    const c=(await client.query("INSERT INTO public.approvals(request_id,approver_id,approval_level,status,is_active,updated_at) VALUES($1,1,3,'On Hold',true,$2) RETURNING id",[request.id,at(98)])).rows[0];
    assert(c.id);assert.equal(await days(),7);
    assert.deepEqual((await client.query('SELECT * FROM public.approval_logs WHERE request_id=$1 AND id=ANY($2::int[]) ORDER BY id',[request.id,history.map(row=>row.id)])).rows,history);
    await client.query("UPDATE public.approvals SET status='Superseded',superseded_at=$2,updated_at=$2 WHERE id=$1",[a.id,at(99.5)]);
    // Terminal transitions without a closing log stop at the recorded state time.
    await client.query('DELETE FROM public.approvals WHERE id=$1',[c.id]);
    assert.equal(await days(),8.5);
    const d=(await client.query("INSERT INTO public.approvals(request_id,approver_id,approval_level,status,is_active,updated_at) VALUES($1,1,4,'Pending',false,$2) RETURNING id",[request.id,at(100)])).rows[0];
    await log(d.id,'On Hold',98);
    assert.equal(await days(),8.5,'a later ordinary edit is not evidence of a historical resume time');
    console.log('SQL 048 + real dashboard queries: 90-day, parallel, repeated, active, clipped and terminal holds; aging buckets/workload; counts, spend and history preserved PASS');
  } finally {await client.query('ROLLBACK');pool.query=originalQuery;}
};
