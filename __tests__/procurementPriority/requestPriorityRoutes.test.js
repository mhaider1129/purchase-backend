const express=require('express');
const supertest=require('supertest');
const mockRead=jest.fn(),mockReorder=jest.fn(),mockTransaction=jest.fn(work=>work({query:jest.fn()}));
jest.mock('../../repositories/procurementPriorityRepository',()=>({createProcurementPriorityRepository:()=>({transaction:mockTransaction})}));
jest.mock('../../repositories/requestPriorityRepository',()=>({createRequestPriorityRepository:()=>({read:mockRead,reorder:mockReorder})}));
jest.mock('../../services/procurementPriority/departmentPriorityCoverageService',()=>({ensureApprovedDepartmentPriorityCoverage:jest.fn()}));
const router=require('../../routes/procurementPriority');
const appFor=permissions=>{const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:1,institute_id:7,department_id:9,requirePermission:p=>{if(!permissions.includes(p))throw Object.assign(new Error('Forbidden'),{statusCode:403});}};next();});app.use(router);app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({message:e.message}));return app;};
beforeEach(()=>jest.clearAllMocks());
test.each([['get','/requests/department'],['get','/requests/manage'],['put','/requests/department/order'],['put','/requests/institutional-order']])('unauthorized %s %s does not touch queues',async(method,path)=>{
 const response=await supertest(appFor([]))[method](path).send({ordered_request_ids:[208],snapshots:{}});
 expect(response.status).toBe(403);expect(mockRead).not.toHaveBeenCalled();expect(mockReorder).not.toHaveBeenCalled();
});
test('department save is scoped to the signed-in user, ignoring forged tenant fields',async()=>{
 mockReorder.mockResolvedValue([{request_id:208}]);
 const response=await supertest(appFor(['procurement-priority.rank-department'])).put('/requests/department/order').send({ordered_request_ids:[208],snapshots:{208:{}},institute_id:8,department_id:99});
 expect(response.status).toBe(200);
 expect(mockReorder).toHaveBeenCalledWith(expect.objectContaining({instituteId:7,departmentId:9,actorId:1,scope:'department',orderedRequestIds:[208]}));
});
test.each(['/department/reorder','/institutional-order','/cases/11/institutional-rank'])('legacy mutation %s cannot split a request',async path=>{
 const response=await supertest(appFor(['procurement-priority.override'])).put(path).send({});
 expect(response.status).toBe(409);expect(response.body.code).toBe('REQUEST_PRIORITY_CLIENT_UPGRADE_REQUIRED');expect(mockReorder).not.toHaveBeenCalled();
});
