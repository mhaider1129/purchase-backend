const reporting=require('../services/procurementReportingService');
const actor={id:7,institute_id:2,department_id:3,permissions:['requests.view-all']};
describe('canonical reporting authorization and contract',()=>{
 test('institute input and data scopes cannot grant cross-institute authority',()=>{
  const params=[],s=reporting.scope({...actor,data_scopes:{institute_ids:[9]}},{institute_id:9,department_id:'12'},params);
  expect(params).toEqual([[2],12]);expect(s.sql).toContain('ownership.institute_id=r.institute_id');
 });
 test('cross-institute reporting needs the existing explicit grant and bounded scopes',()=>{
  expect(reporting.scope({...actor,permissions:[...actor.permissions,'requests.cross-institute'],data_scopes:{institute_ids:[9]}}).params[0]).toEqual([2,9]);
 });
 test('missing institute fails closed',()=>expect(()=>reporting.scope({id:7})).toThrow('institute account'));
 test('department/warehouse filters narrow rather than grant visibility',()=>{
  const s=reporting.scope({id:8,institute_id:2,department_id:3,permissions:['requests.view']},{department_id:4});
  expect(s.sql).toContain('r.requester_id=');expect(s.sql).toContain('r.department_id=');
  expect(()=>reporting.scope({id:8,institute_id:2,warehouse_id:1,permissions:['warehouse.view-supply']},{warehouse_id:9})).toThrow('scope denied');
 });
 test('filters reject invalid IDs and calendar dates',()=>{
  for(const query of [{department_id:'1 OR 1=1'},{from_date:'2026-02-30'},{from_date:'2026-03-01',to_date:'2026-02-28'}])expect(()=>reporting.source(actor,query)).toThrow();
 });
 test('source uses canonical projection and an explicit version, not payment or assignment completion',()=>{
  const {cte}=reporting.source(actor,{completion_category:'fully_fulfilled'});
  expect(cte).toContain('canonical_procurement_completion');expect(cte).toContain('canonical_completion_v1');expect(cte).not.toContain('payment_status');
 });
 test('legacy scoping preserves bound parameters and existing WITH queries',async()=>{
  const db={query:jest.fn().mockResolvedValue({rows:[]})};
  await reporting.scopedDatabase(db,actor).query('WITH old AS (SELECT $1::int id) SELECT * FROM requests r JOIN old ON old.id=r.id',[11]);
  expect(db.query.mock.calls[0][0]).toContain('WITH requests AS MATERIALIZED');expect(db.query.mock.calls[0][1]).toEqual([11,[2]]);
 });
 test('missing Phase 6B schema does not return invented zero metrics',async()=>{
  await expect(reporting.summary(actor,{}, {query:jest.fn().mockResolvedValue({rows:[{ready:false}]})})).rejects.toMatchObject({statusCode:503,code:'COMPLETION_SCHEMA_REQUIRED'});
 });
});
