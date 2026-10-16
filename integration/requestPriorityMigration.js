'use strict';
const assert=require('node:assert/strict');
module.exports=async(client,patch)=>{
  assert.equal(client.connectionParameters.host,'127.0.0.1');
  assert.equal(client.connectionParameters.user,'p2p_test');
  await client.query(patch);
  const request=(await client.query("INSERT INTO public.requests(request_type,status) VALUES('Stock','Approved') RETURNING id")).rows[0];
  try {
    await client.query('INSERT INTO public.request_priority_rankings(request_id,institute_id,department_id,department_rank,institutional_rank,row_version,updated_by,institutional_override_reason) VALUES($1,7,9,4,2,8,1,$2)',[request.id,'Preserve reviewed priority']);
    const before=(await client.query('SELECT * FROM public.request_priority_rankings WHERE request_id=$1',[request.id])).rows[0];
    await client.query(patch);
    assert.deepEqual((await client.query('SELECT * FROM public.request_priority_rankings WHERE request_id=$1',[request.id])).rows[0],before);
    assert.equal((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.request_priority_rankings'::regclass")).rows[0].relrowsecurity,true);
    await assert.rejects(client.query('INSERT INTO public.request_priority_rankings(request_id,institute_id,department_id) VALUES($1,7,9)',[request.id]),{code:'23505'});
    await assert.rejects(client.query('UPDATE public.request_priority_rankings SET department_rank=0 WHERE request_id=$1',[request.id]),{code:'23514'});
    console.log('SQL 047: populated repeat application preserves ranks, reasons, actor and version; request uniqueness, rank checks and RLS PASS');
  } finally {
    await client.query('DELETE FROM public.request_priority_rankings WHERE request_id=$1',[request.id]);
    await client.query('DELETE FROM public.requests WHERE id=$1',[request.id]);
  }
};
