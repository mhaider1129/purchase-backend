jest.mock('../config/db',()=>({query:jest.fn(),connect:jest.fn()}));
jest.mock('../utils/permissionService',()=>({...jest.requireActual('../utils/permissionService'),getPermissionsForUserId:jest.fn()}));
jest.mock('../utils/ensureProcurementPlanTables',()=>jest.fn().mockResolvedValue());
jest.mock('../utils/storage',()=>({uploadBuffer:jest.fn().mockResolvedValue({objectKey:'plans/new.pdf'})}));
jest.mock('../services/attachmentStorageAdapter',()=>({download:jest.fn((_p,_req,res)=>res.send('Authorized plan')),remove:jest.fn().mockResolvedValue()}));
const express=require('express'),jwt=require('jsonwebtoken');
const pool=require('../config/db');
const {getPermissionsForUserId}=require('../utils/permissionService');
const fixture=require('./helpers/planningFixture');
const storage=require('../utils/storage');
const fileStorage=require('../services/attachmentStorageAdapter');
let f,server,base;
beforeAll(async()=>{
 const app=express();app.use(express.json());app.use('/planning',require('../routes/planning'));app.use('/plans',require('../routes/procurementPlans'));
 app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message,code:error.code}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(()=>new Promise(resolve=>server.close(resolve)));
beforeEach(()=>{jest.clearAllMocks();f=fixture(pool,getPermissionsForUserId);});
async function call(path,{user=9,method='GET',body,form}={}){
 const headers=user?{Authorization:`Bearer ${jwt.sign({user_id:user},process.env.JWT_SECRET)}`}:{ };
 if(body)headers['Content-Type']='application/json';
 const response=await fetch(base+path,{method,headers,body:form|| (body?JSON.stringify(body):undefined)});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data};
}
test.each(['/planning/defaults','/plans','/plans/5/items','/plans/5/download'])('anonymous %s denied',async path=>{
 expect((await call(path,{user:null})).status).toBe(401);expect(f.statements).toHaveLength(0);
});
test.each(['/planning/defaults','/plans','/plans/5/items/variance','/plans/5/integration-insights'])('authenticated without capability denied: %s',async path=>{
 expect((await call(path,{user:11})).status).toBe(403);expect(f.statements.some(x=>x.sql.startsWith('CREATE'))).toBe(false);
});
test('viewer lists only scoped plans and can download authorized plan',async()=>{
 const listed=await call('/plans',{user:10});expect(listed.status).toBe(200);expect(listed.data.map(x=>x.id)).toEqual([5]);
 expect((await call('/plans/5/items',{user:10})).status).toBe(200);
 expect((await call('/plans/5/download',{user:10})).status).toBe(200);
 expect((await call('/plans/7',{user:10})).status).toBe(404);
});
test('viewer cannot modify defaults, plan items, policies or generate tasks',async()=>{
 for(const path of ['/planning/defaults','/planning/replenishment/policies','/planning/replenishment/run','/plans/5/items'])
  expect((await call(path,{user:10,method:'POST',body:{warehouse_id:10,stock_item_id:3,items:[{item_name:'A',planned_quantity:2}]}})).status).toBe(403);
 expect(f.state.audits).toHaveLength(0);
});
test.each([['/plans/5/items',12],['/plans/6/items',9],['/plans/7',10],['/planning/defaults?warehouse_id=11',13],['/planning/defaults?warehouse_id=20',9]])('unauthorized scoped record %s rejected',async(path,user)=>{
 expect((await call(path,{user})).status).toBe(404);
});
test('forged institute ID never changes saved ownership or actor',async()=>{
 const response=await call('/planning/defaults',{method:'POST',body:{institute_id:8,updated_by:111,forecast_horizon_months:4}});
 expect(response.status).toBe(200);expect(response.data.settings).toMatchObject({institute_id:7,updated_by:9,forecast_horizon_months:4});
 expect(f.state.audits[0]).toMatchObject({actor_id:9,instituteId:7,action:'planning.defaults.saved'});
});
test('department planner cannot change institute-wide defaults',async()=>{
 expect((await call('/planning/defaults',{user:13,method:'POST',body:{warehouse_id:null}})).status).toBe(403);
});
test('legacy unowned global defaults are preserved but never read',async()=>{
 f.state.settings=[{id:99,institute_id:null,warehouse_id:null,forecast_horizon_months:99}];
 const response=await call('/planning/defaults',{user:10});expect(response.status).toBe(200);
 expect(response.data.settings).toMatchObject({forecast_horizon_months:6,defaults_scope:'built_in'});expect(f.state.settings[0].institute_id).toBeNull();
});
test('missing ownership migration fails closed without runtime DDL',async()=>{
 f.state.schema=false;const response=await call('/planning/defaults');expect(response.status).toBe(503);expect(response.data.code).toBe('PLANNING_SCOPE_SCHEMA_REQUIRED');
 expect(f.statements.some(x=>x.sql.startsWith('CREATE TABLE'))).toBe(false);
});
test('SCM policy update persists before/after and leaves balances untouched',async()=>{
 const before=structuredClone(f.state.balances),response=await call('/planning/replenishment/policies',{method:'POST',body:{warehouse_id:10,stock_item_id:3,reorder_point:20,safety_stock:3,lead_time_days:0}});
 expect(response.status).toBe(200);expect(response.data.policy).toMatchObject({reorder_point:20,updated_by:9});
 expect(f.state.audits[0]).toMatchObject({instituteId:7,beforeData:{reorder_point:10},afterData:{reorder_point:20}});expect(f.state.balances).toEqual(before);
});
test.each([{warehouse_id:20,stock_item_id:3},{warehouse_id:10,stock_item_id:4},{warehouse_id:30,stock_item_id:3}])('foreign/unknown policy reference %j denied',async body=>{
 expect((await call('/planning/replenishment/policies',{method:'POST',body})).status).toBe(404);expect(f.state.audits).toHaveLength(0);
});
test('repeated and concurrent demand generation reuses one active advisory task',async()=>{
 const responses=await Promise.all([call('/planning/replenishment/run',{method:'POST',body:{warehouse_id:10}}),call('/planning/replenishment/run',{method:'POST',body:{warehouse_id:10}})]);
 responses.forEach(r=>expect(r.status).toBe(200));expect(f.state.tasks).toHaveLength(1);expect(f.state.audits).toHaveLength(1);
 expect(responses[0].data.tasks[0].id).toBe(responses[1].data.tasks[0].id);
 expect((await call('/planning/replenishment/run',{method:'POST',body:{warehouse_id:10}})).data.tasks[0].id).toBe(f.state.tasks[0].id);
});
test('concurrent policy revisions retain serialized before/after audit history',async()=>{
 const responses=await Promise.all([20,30].map(reorder_point=>call('/planning/replenishment/policies',{method:'POST',body:{warehouse_id:10,stock_item_id:3,reorder_point}})));
 responses.forEach(r=>expect(r.status).toBe(200));expect(f.state.audits).toHaveLength(2);
 expect(f.state.audits[1].beforeData.reorder_point).toBe(f.state.audits[0].afterData.reorder_point);
});
test.each(['/planning/defaults','/planning/replenishment/policies','/planning/replenishment/run','/plans/5/items'])('audit failure rolls back %s',async path=>{
 f.failAudit=true;const before=structuredClone(f.state);
 const response=await call(path,{method:'POST',body:{warehouse_id:10,stock_item_id:3,reorder_point:30,items:[{item_name:'B',planned_quantity:2}]}});
 expect(response.status).toBe(500);expect(f.state).toEqual(before);
});
test('SCM can create items and link only matching department demand/consumption',async()=>{
 expect((await call('/plans/5/items',{method:'POST',body:{items:[{item_name:'B',planned_quantity:2,stock_item_id:3}]}})).status).toBe(201);
 expect((await call('/plans/5/items/51/requests',{method:'POST',body:{requested_item_ids:[41,41]}})).status).toBe(201);expect(f.state.links).toHaveLength(1);
 for(const requested_item_ids of [[42],[43]])expect((await call('/plans/5/items/51/requests',{method:'POST',body:{requested_item_ids}})).status).toBe(404);
 for(let i=0;i<2;i++)expect((await call('/plans/5/items/51/consumptions',{method:'POST',body:{warehouse_stock_movement_ids:[81]}})).status).toBe(201);
 expect(f.state.consumptions).toHaveLength(1);
});
test('foreign/cross-warehouse consumption cannot be linked by department planner',async()=>{
 expect((await call('/plans/5/items/51/consumptions',{user:13,method:'POST',body:{warehouse_stock_movement_ids:[83]}})).status).toBe(404);
 expect((await call('/plans/5/items/51/consumptions',{method:'POST',body:{warehouse_stock_movement_ids:[82]}})).status).toBe(404);
});
test('old foreign links are not included in variance or insights',async()=>{
 f.state.links=[{id:1,plan_item_id:51,request_id:32,requested_item_id:42,quantity:999}];
 for(const path of ['/plans/5/items/variance','/plans/5/integration-insights'])expect((await call(path)).status).toBe(404);
});
test('forecast history is scoped; unowned monthly dispensing is not queried',async()=>{
 const response=await call('/planning/forecast',{user:10,method:'POST',body:{item_name:'A',institute_id:8}});expect(response.status).toBe(200);
 const history=f.statements.find(x=>x.sql.startsWith('SELECT TO_CHAR(r.created_at'));expect(history.sql).toContain('r.institute_id=$3');expect(history.p[2]).toBe(7);expect(history.p[4]).toEqual([2]);
 expect(f.statements.some(x=>x.sql.includes('FROM monthly_dispensing'))).toBe(false);
});
test('neither preparation nor replenishment capability creates an approval API',async()=>{
 expect((await call('/plans/5/approve',{user:13,method:'POST',body:{}})).status).toBe(404);
 expect(f.state.requests.every(r=>r.status==null)).toBe(true);
});
test('upload rechecks planning scope and audits creation; audit failure removes only new storage object',async()=>{
 storage.uploadBuffer.mockResolvedValueOnce({objectKey:'plans/success.pdf'}).mockResolvedValueOnce({objectKey:'plans/failed.pdf'});
 let form=new FormData();form.append('plan_year','2026');form.append('department_id','2');form.append('plan',new Blob(['test plan']),'plan.pdf');
 const response=await call('/plans',{method:'POST',form});expect(response.status).toBe(201);expect(f.state.audits[0].action).toBe('planning.plan.uploaded');
 f.failAudit=true;form=new FormData();form.append('plan_year','2027');form.append('department_id','2');form.append('plan',new Blob(['test plan']),'plan2.pdf');
 expect((await call('/plans',{method:'POST',form})).status).toBe(500);expect(fileStorage.remove).toHaveBeenCalledWith({file_path:'plans/failed.pdf'});expect(storage.uploadBuffer).toHaveBeenCalledTimes(2);
});

test('upload permission revoked during storage cannot publish metadata',async()=>{
 storage.uploadBuffer.mockImplementationOnce(async()=>{f.state.users[13].permissions=[];return{objectKey:'plans/revoked.pdf'};});
 const form=new FormData();form.append('plan_year','2026');form.append('department_id','2');form.append('plan',new Blob(['test']),'plan.pdf');
 const before=f.state.plans.length;expect((await call('/plans',{user:13,method:'POST',form})).status).toBe(403);
 expect(f.state.plans).toHaveLength(before);expect(fileStorage.remove).toHaveBeenCalledWith({file_path:'plans/revoked.pdf'});
});
test('no planning mutation writes canonical procurement, approval or inventory owners',async()=>{
 await call('/planning/replenishment/run',{method:'POST',body:{warehouse_id:10}});
 await call('/plans/5/items/51/requests',{method:'POST',body:{requested_item_ids:[41]}});
 expect(f.statements.filter(x=>/^(UPDATE|INSERT INTO|DELETE FROM) (requests|requested_items|warehouse_stock_levels|inventory_movements|goods_receipt_items|purchase_orders|commitment_ledger|ap_payables|approvals)\b/i.test(x.sql))).toEqual([]);
});
test('mixed valid and foreign source links roll back the complete batch',async()=>{
 const response=await call('/plans/5/items/51/requests',{method:'POST',body:{requested_item_ids:[41,42]}});
 expect(response.status).toBe(404);expect(f.state.links).toHaveLength(0);expect(f.state.audits).toHaveLength(0);
});
test('both source fields on an old consumption link are rejected as ambiguous',async()=>{
 f.state.consumptions=[{id:1,plan_item_id:51,warehouse_stock_movement_id:81,department_stock_movement_id:91,quantity:4}];
 expect((await call('/plans/5/items/variance')).status).toBe(404);
});
