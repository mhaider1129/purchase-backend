const express = require('express');
const request = require('supertest');
const mockClient = { query:jest.fn(),release:jest.fn() };
const mockFindGate=jest.fn(),mockCoverage=jest.fn(),mockReorder=jest.fn(),mockContinue=jest.fn();
jest.mock('../../config/db',()=>({connect:jest.fn(async()=>mockClient)}));
jest.mock('../../middleware/authMiddleware',()=>({authenticateUser:(_req,_res,next)=>next()}));
jest.mock('../../controllers/approvalsController',()=>Object.fromEntries(['handleApprovalDecision','handleEmailApprovalAction','getApprovalDetailsForRequest','getApprovalSummary','updateApprovalItems','setApprovalHoldStatus','notifyCurrentApprovalByEmail'].map(name=>[name,(_req,_res,next)=>next()])));
jest.mock('../../services/procurementPriority/hodRankingGateService',()=>({findGate:(...args)=>mockFindGate(...args)}));
jest.mock('../../services/procurementPriority/departmentPriorityCoverageService',()=>({ensureApprovedDepartmentPriorityCoverage:(...args)=>mockCoverage(...args)}));
jest.mock('../../services/auditService',()=>({writeAuditEvent:jest.fn()}));
jest.mock('../../repositories/procurementPriorityRepository',()=>({createProcurementPriorityRepository:()=>({})}));
jest.mock('../../repositories/requestPriorityRepository',()=>({createRequestPriorityRepository:()=>({reorder:(...args)=>mockReorder(...args)})}));
jest.mock('../../services/approvalContinuationService',()=>({continueApprovalWorkflowAfterLevel:(...args)=>mockContinue(...args)}));
jest.mock('../../controllers/utils/approvalRoutes',()=>({resolveRouteDomain:jest.fn(),fetchApprovalRoutes:jest.fn(async()=>[{approval_level:2,role:'HOD'}])}));
jest.mock('../../utils/notificationService',()=>({createNotifications:jest.fn()}));
const router=require('../../routes/approvals');
const actor={id:5,role:'HOD',institute_id:7,department_id:9,requirePermission:jest.fn()};
const decision={id:41,request_id:41,approval_id:8,approval_level:2,approver_id:5,approval_status:'Approved',is_superseded:false,institute_id:7,department_id:9,status:'Submitted'};
const appFor=(user=actor)=>{const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next()});app.use(router);app.use((err,_req,res,_next)=>res.status(err.statusCode||500).json({message:err.message}));return app;};
beforeEach(()=>{jest.clearAllMocks();mockClient.query.mockImplementation(async sql=>({rows:sql.includes('SELECT a.id AS approval_id')?[decision]:[],rowCount:0}));mockFindGate.mockResolvedValue({requestId:41,queue:[{request_id:41}]});actor.requirePermission.mockImplementation(()=>{});mockContinue.mockResolvedValue({state:'NEXT_APPROVAL_ACTIVE'});});

test('reload after approval returns a current institute/department scoped queue without advancing the workflow',async()=>{
 const response=await request(appFor()).get('/8/department-ranking');
 expect(response.status).toBe(200);expect(mockClient.query.mock.calls[1][1]).toEqual(['8',5,7,9]);
 expect(mockCoverage).toHaveBeenCalledWith(expect.objectContaining({instituteId:7,departmentId:9,actorId:5}));
 expect(mockFindGate).toHaveBeenCalledWith(expect.objectContaining({request:decision,force:true}));
 expect(mockReorder).not.toHaveBeenCalled();expect(mockContinue).not.toHaveBeenCalled();
});
test.each([{approval_status:'Pending'},{approval_status:'Rejected'},{is_superseded:true}])('a non-current/non-approved decision cannot open placement %j',async fields=>{
 mockClient.query.mockImplementation(async sql=>({rows:sql.includes('SELECT a.id AS approval_id')?[{...decision,...fields}]:[]}));
 expect((await request(appFor()).get('/8/department-ranking')).status).toBe(409);expect(mockFindGate).not.toHaveBeenCalled();
});
test('a different actor, department or institute cannot load the candidate',async()=>{
 mockClient.query.mockResolvedValue({rows:[]});expect((await request(appFor()).get('/8/department-ranking')).status).toBe(403);
 expect(mockCoverage).not.toHaveBeenCalled();
});
test('role and explicit rank permission are enforced',async()=>{
 expect((await request(appFor({...actor,role:'SCM'})).get('/8/department-ranking')).status).toBe(403);
 actor.requirePermission.mockImplementation(()=>{throw Object.assign(new Error('Forbidden'),{statusCode:403})});
 expect((await request(appFor()).get('/8/department-ranking')).status).toBe(403);expect(mockFindGate).not.toHaveBeenCalled();
});
test('an approved request which completed while opening the popup returns no placement',async()=>{
 mockFindGate.mockResolvedValue(null);const response=await request(appFor()).get('/8/department-ranking');expect(response.status).toBe(200);expect(response.body.data).toBeNull();
});
test('a gate can save a Submitted request with an Approved HOD decision; the two statuses must not be confused',async()=>{
 mockClient.query.mockImplementation(async sql=>({rows:sql.includes('SELECT a.*,r.*')?[{...decision,id:8,request_status:'Submitted',approver_role:'HOD'}]:[],rowCount:0}));
 mockReorder.mockResolvedValue([{request_id:41}]);
 const response=await request(appFor()).post('/8/department-ranking').send({ordered_request_ids:[41],snapshots:{41:{}}});
 expect(response.status).toBe(200);expect(mockReorder).toHaveBeenCalled();expect(mockContinue).toHaveBeenCalledTimes(1);
});
