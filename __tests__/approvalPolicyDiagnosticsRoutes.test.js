const mockDetail=jest.fn(),mockSimulate=jest.fn();
jest.mock('../services/approvalPolicyService',()=>({getShadowRun:(...args)=>mockDetail(...args),simulate:(...args)=>mockSimulate(...args)}));
const express=require('express'),request=require('supertest');
const router=require('../routes/approvalPolicies');
let user;
const app=express();
app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});app.use(router);
app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({error:error.message}));
beforeEach(()=>{jest.clearAllMocks();user={id:7,institute_id:1,permissions:[]};mockDetail.mockResolvedValue({summary:{ruleDiagnostics:[]}});mockSimulate.mockResolvedValue({ruleDiagnostics:[]})});
test.each([null,{id:7,institute_id:1,permissions:[]}])('diagnostic history cannot bypass authentication and shadow-view permission',async actor=>{
  user=actor;
  const response=await request(app).get('/approval-policy-shadow-runs/4');
  expect(response.status).toBe(actor?403:401);expect(mockDetail).not.toHaveBeenCalled();
});
test('recorded diagnostics use the authenticated institute rather than client scope',async()=>{
  user.permissions=['approval-policy.view-shadow'];
  const response=await request(app).get('/approval-policy-shadow-runs/4?instituteId=999');
  expect(response.status).toBe(200);expect(mockDetail).toHaveBeenCalledWith('4',{id:7,instituteId:1});
});
test('viewing diagnostics does not grant simulation permission',async()=>{
  user.permissions=['approval-policy.view-shadow'];
  expect((await request(app).post('/approval-policy-versions/20/simulate').send({requestType:'Non-Stock'})).status).toBe(403);
  expect(mockSimulate).not.toHaveBeenCalled();
});
