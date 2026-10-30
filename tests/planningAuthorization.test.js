jest.mock('../config/db',()=>({query:jest.fn(),connect:jest.fn()}));
jest.mock('../utils/permissionService',()=>({...jest.requireActual('../utils/permissionService'),getPermissionsForUserId:jest.fn()}));
const pool=require('../config/db');
const {getPermissionsForUserId}=require('../utils/permissionService');
const {createPlanningAuthorization}=require('../services/planningAuthorizationService');
const fixture=require('./helpers/planningFixture');
let f,access;
beforeEach(()=>{f=fixture(pool,getPermissionsForUserId);access=createPlanningAuthorization(pool);});
test('actor identity and grants are reloaded; supplied institute and permissions are not authoritative',async()=>{
 const a=await access.actor({id:10,institute_id:8,permissions:['planning.manage']});
 expect(a.institute_id).toBe(7);expect(a.permissions).toEqual(['planning.view']);
 await expect(access.plan(a,5,'manage')).rejects.toMatchObject({statusCode:403});
});
test.each([null,{}, {id:999}])('missing/unknown actor fails closed: %j',async actor=>{
 await expect(access.actor(actor)).rejects.toMatchObject({statusCode:actor?.id?403:401});
});
test('inactive actor and missing institute fail closed',async()=>{
 f.state.users[9].is_active=false;await expect(access.actor({id:9})).rejects.toMatchObject({statusCode:403});
 f.state.users[9].is_active=true;f.state.users[9].institute_id=null;await expect(access.actor({id:9})).rejects.toMatchObject({statusCode:403});
});
test('same-role manager cannot address a foreign institute or unowned root',async()=>{
 const a=await access.actor({id:9});await expect(access.plan(a,6)).rejects.toMatchObject({statusCode:404});
 await expect(access.warehouse(a,20)).rejects.toMatchObject({statusCode:404});await expect(access.warehouse(a,30)).rejects.toMatchObject({statusCode:404});
});
test('capability alone does not authorize another department/warehouse',async()=>{
 const a=await access.actor({id:13});await expect(access.plan(a,7)).rejects.toMatchObject({statusCode:404});
 await expect(access.warehouse(a,11)).rejects.toMatchObject({statusCode:404});
});
test('bounded data scopes extend local access without granting foreign scope',async()=>{
 f.state.users[13].data_scopes={department_ids:['3','4'],warehouse_ids:['11','20']};const a=await access.actor({id:13});
 await expect(access.plan(a,7)).resolves.toMatchObject({id:7});await expect(access.warehouse(a,11)).resolves.toMatchObject({id:11});
 await expect(access.plan(a,6)).rejects.toMatchObject({statusCode:404});await expect(access.warehouse(a,20)).rejects.toMatchObject({statusCode:404});
});
test('shared stock requires a concrete scoped association; explicit foreign ownership never falls back',async()=>{
 const a=await access.actor({id:9});await expect(access.stock(a,5,{warehouseId:10})).resolves.toMatchObject({id:5});
 await expect(access.stock(a,5,{departmentId:2})).rejects.toMatchObject({statusCode:404});
 await expect(access.stock(a,4,{warehouseId:10})).rejects.toMatchObject({statusCode:404});
});
test('linked sources must have the exact plan department and item parent',async()=>{
 const a=await access.actor({id:9});await expect(access.requestedItem(a,43,2)).rejects.toMatchObject({statusCode:404});
 await expect(access.planItem(a,5,999)).rejects.toMatchObject({statusCode:404});
 await expect(access.movement(a,'warehouse',82,2)).rejects.toMatchObject({statusCode:404});
});
test('other domain grants and broad scopes are not planning capabilities',async()=>{
 f.state.users[11].permissions=['requests.manage','stock-requests.create','procurement.update-status','planning.cross-department','planning.cross-warehouse'];
 await expect(access.actor({id:11})).rejects.toMatchObject({statusCode:403,code:'PLANNING_PERMISSION_DENIED'});
});
test('malformed authorization data fails closed',async()=>{
 getPermissionsForUserId.mockResolvedValue({permissions:null,dataScopes:{}});
 await expect(access.actor({id:9})).rejects.toMatchObject({statusCode:503});
});

test('linked request warehouse must be authorized even when its department is permitted',async()=>{
 const a=await access.actor({id:13});
 const request=f.state.requests.find(r=>r.id===31);
 request.warehouse_id=11;
 await expect(access.requestedItem(a,41,2)).rejects.toMatchObject({statusCode:404});
 request.warehouse_id=20;
 await expect(access.requestedItem(a,41,2)).rejects.toMatchObject({statusCode:404});
 request.warehouse_id=10;
 await expect(access.requestedItem(a,41,2)).resolves.toMatchObject({id:41});
});
