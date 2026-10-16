const {requestQueue,assertRequestSnapshot}=require('../../services/procurementPriority/requestQueueService');
const cases=[
  {procurement_case_id:11,request_id:208,public_title:'Hook',row_version:3,department_rank:1,institutional_rank:1,system_score:60,system_tier:'P2'},
  {procurement_case_id:12,request_id:209,public_title:'Chair',row_version:8,department_rank:2,institutional_rank:2,system_score:85,system_tier:'P1'},
  {procurement_case_id:13,request_id:208,public_title:'Cable',row_version:4,department_rank:3,institutional_rank:3,system_score:50,system_tier:'P3'},
];
test('multi-item requests occupy one position; scores are not summed and legacy highest position initializes order',()=>{
  const rows=requestQueue(cases,[],'department');
  expect(rows.map(row=>[row.request_id,row.department_rank,row.item_count])).toEqual([[208,1,2],[209,2,1]]);
  expect(rows[0]).toMatchObject({system_score:60,system_tier:'P2',department_rank_total:2,system_suggested_rank:2});
  expect(rows[0].snapshot).toEqual({rank_version:'0',cases:{11:'3',13:'4'}});
});
test('saved whole-request ranks override conflicting item positions without changing assessments',()=>{
  const rows=requestQueue(cases,[{request_id:208,institutional_rank:8,row_version:5},{request_id:209,institutional_rank:3,row_version:2}],'institutional');
  expect(rows.map(row=>row.request_id)).toEqual([209,208]);
  expect(rows[1].institutional_rank).toBe(2);
  expect(cases[0].department_rank).toBe(1);
});
test('normalized departmental positions are not mixed with raw saved ranks after completion',()=>{
  const rows=requestQueue(cases,[{request_id:208,department_rank:5,row_version:2}], 'department');
  expect(rows.map(row=>row.request_id)).toEqual([208,209]);
});
test('an unassessed request stays unassessed and duplicate group joins do not duplicate items',()=>{
  const rows=requestQueue([{...cases[0],system_tier:null,system_score:null},cases[0],{...cases[2],request_id:999,system_tier:null,system_score:null}],[]);
  expect(rows[0].item_count).toBe(1);
  expect(rows[1].system_suggested_rank).toBeNull();
});
test('group filters include every member group without duplicating a request or its items',()=>{
  const rows=requestQueue([{...cases[0],priority_group_name:'Initiative A'},{...cases[0],priority_group_name:'Initiative B'}]);
  expect(rows).toHaveLength(1);
  expect(rows[0].item_count).toBe(1);
  expect(rows[0].priority_group_names).toEqual(['Initiative A','Initiative B']);
});
test('complete request snapshot accepts different item versions',()=>{
  const rows=requestQueue(cases,[],'department');
  expect(()=>assertRequestSnapshot(rows,[209,208],Object.fromEntries(rows.map(row=>[row.request_id,row.snapshot])))).not.toThrow();
});
test('a user without a department cannot fall back to an institution-wide departmental read',async()=>{
  const {createRequestPriorityRepository}=require('../../repositories/requestPriorityRepository');
  const repository=createRequestPriorityRepository({departmentQueue:jest.fn(),managementQueue:jest.fn()});
  await expect(repository.read({client:{query:jest.fn()},instituteId:7,scope:'department'})).rejects.toMatchObject({statusCode:403});
});
test.each(['stale member','missing member','new member','changed rank','missing request','duplicate request','foreign request'])("rejects %s",kind=>{
  const rows=requestQueue(cases,[],'department');
  const snapshots=JSON.parse(JSON.stringify(Object.fromEntries(rows.map(row=>[row.request_id,row.snapshot]))));
  let ids=[208,209];
  if(kind==='stale member')snapshots[208].cases[13]='2';
  if(kind==='missing member')delete snapshots[208].cases[13];
  if(kind==='new member')snapshots[208].cases[99]='1';
  if(kind==='changed rank')snapshots[208].rank_version='5';
  if(kind==='missing request')ids=[208];
  if(kind==='duplicate request')ids=[208,208];
  if(kind==='foreign request')ids=[208,999];
  expect(()=>assertRequestSnapshot(rows,ids,snapshots)).toThrow(expect.objectContaining({statusCode:409}));
});
