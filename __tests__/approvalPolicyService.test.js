const mockQuery=jest.fn(),mockRelease=jest.fn(),mockConnect=jest.fn();
jest.mock('../config/db',()=>({query:(...a)=>mockQuery(...a),connect:(...a)=>mockConnect(...a)}));
const mockRepo={getVersion:jest.fn(),listRules:jest.fn(),listConditions:jest.fn(),listSteps:jest.fn(),getPolicy:jest.fn(),getVersions:jest.fn(),listPolicies:jest.fn(),getShadowRun:jest.fn(),getShadowSteps:jest.fn(),getShadowDifferences:jest.fn(),getCurrentRouteForRun:jest.fn(),listShadowRuns:jest.fn()};jest.mock('../repositories/approvalPolicyRepository',()=>mockRepo);
jest.mock('../services/auditService',()=>({writeAuditEvent:jest.fn()}));jest.mock('../services/approvalPolicyShadowService',()=>({generateShadowApprovalRoute:jest.fn()}));
const service=require('../services/approvalPolicyService'),shadow=require('../services/approvalPolicyShadowService');const actor={id:1,instituteId:10};
test.each([
  ['Medical','25200000','NONSTOCK_MED_HIGH',6],
  ['Medical','5000000','NONSTOCK_MED_STANDARD',5],
  ['Medical','5000001','NONSTOCK_MED_HIGH',6],
  ['Operational','0','NONSTOCK_OP_STANDARD',4],
  ['Operational','5000000','NONSTOCK_OP_STANDARD',4],
  ['Operational','5000001','NONSTOCK_OP_HIGH',5],
])('supplied export hydrates %s/%s to %s and %s steps',async(classification,amount,code,count)=>{
  const exported=require('./fixtures/nonStockShadowPolicyExport');
  mockRepo.getVersion.mockResolvedValue({rows:[{...exported.version}]});
  mockRepo.listRules.mockResolvedValue({rows:exported.rules.map(rule=>({...rule}))});
  mockRepo.listConditions.mockImplementation(async id=>({rows:exported.conditions.filter(condition=>condition.policy_rule_id===id).map(condition=>({type:condition.condition_type,value:condition.condition_value}))}));
  mockRepo.listSteps.mockImplementation(async id=>({rows:exported.steps.filter(step=>step.policy_rule_id===id).map(step=>({approvalLevel:step.approval_level,stepOrder:step.step_order,semanticKey:step.semantic_key,resolverType:step.resolver_type,resolverReference:step.resolver_reference}))}));
  const hydrated=await service.hydrateVersion(20,{id:1,instituteId:1});
  expect(hydrated.rules[0].conditions[1].value).toBe('medical');
  // This is the exact pre-fix equality failure with the owner's supplied values.
  expect(hydrated.rules.find(rule=>rule.code===code).conditions[1].value===classification).toBe(false);
  const dependencies={organization:{resolveDepartmentHead:async()=>({userId:100}),resolveExecutiveOwner:async()=>({userId:101}),resolvePosition:async()=>({userId:102})}};
  const route=await require('../services/approvalPolicyEngine').composeShadowRoute(hydrated,{requestType:'Non-Stock',departmentClassification:classification,estimatedAmount:amount,isStockRequest:false},dependencies);
  expect(route.matchedRules.map(rule=>rule.code)).toEqual([code]);
  expect(route.steps).toHaveLength(count);
  expect(route.policy).toMatchObject({id:19,versionId:20,versionNumber:1,status:'SHADOW',activeRuleCount:4});
});
beforeEach(()=>{jest.clearAllMocks();mockConnect.mockResolvedValue({query:mockQuery,release:mockRelease});mockQuery.mockResolvedValue({rows:[],rowCount:0});mockRepo.listRules.mockResolvedValue({rows:[]});mockRepo.listConditions.mockResolvedValue({rows:[]});mockRepo.listSteps.mockResolvedValue({rows:[]});mockRepo.getCurrentRouteForRun.mockResolvedValue({rows:[]})});
test.each([
 ['GET policy',()=>{mockRepo.getPolicy.mockResolvedValue({rows:[]});return service.getPolicy(99,actor)}],
 ['list versions',()=>{mockRepo.getVersions.mockResolvedValue({rows:[]});return service.getVersions(99,actor)}],
 ['GET version',()=>{mockRepo.getVersion.mockResolvedValue({rows:[]});return service.hydrateVersion(99,actor)}],
 ['read shadow run',()=>{mockRepo.getShadowRun.mockResolvedValue({rows:[]});return service.getShadowRun(99,actor)}]
])('%s returns no foreign-institute data',async(_,run)=>{const value=await run();expect(Array.isArray(value)?value.length===0:!value).toBe(true)});
test('all mockRepository reads derive institute scope from actor',async()=>{mockRepo.getPolicy.mockResolvedValue({rows:[{id:2}]});mockRepo.getVersions.mockResolvedValue({rows:[]});mockRepo.getShadowRun.mockResolvedValue({rows:[{id:3}]});mockRepo.getShadowSteps.mockResolvedValue({rows:[]});mockRepo.getShadowDifferences.mockResolvedValue({rows:[]});await service.getPolicyDetail(2,actor);await service.getShadowRun(3,actor);expect(mockRepo.getPolicy).toHaveBeenCalledWith(2,10);expect(mockRepo.getVersions).toHaveBeenCalledWith(2,10);expect(mockRepo.getShadowRun).toHaveBeenCalledWith(3,10);expect(mockRepo.getShadowSteps).toHaveBeenCalledWith(3,10);expect(mockRepo.getShadowDifferences).toHaveBeenCalledWith(3,10)});
test('hydration keeps persisted condition text and uses the explicitly selected version',async()=>{
  const conditions=[{type:'REQUEST_TYPE_EQUALS',value:'Non-Stock'},{type:'DEPARTMENT_CLASSIFICATION_EQUALS',value:'Medical'},{type:'IS_NON_STOCK_REQUEST',value:'true'},{type:'AMOUNT_GTE',value:'5000001'}];
  mockRepo.getVersion.mockResolvedValue({rows:[{id:12,version_number:1,status:'SHADOW',policy:{id:8,instituteId:10,name:'Non-Stock'}}]});
  mockRepo.listRules.mockResolvedValue({rows:[{id:15,rule_code:'NONSTOCK_MED_HIGH',priority:1,is_active:true,stop_processing:false}]});
  mockRepo.listConditions.mockResolvedValue({rows:conditions});
  mockRepo.listSteps.mockResolvedValue({rows:[]});
  const hydrated=await service.hydrateVersion(12,actor);
  expect(mockRepo.getVersion).toHaveBeenCalledWith(12,10,expect.anything());
  expect(mockRepo.listConditions).toHaveBeenCalledWith(15,10,expect.anything());
  expect(hydrated.rules[0].conditions).toEqual(conditions);
  const route=await require('../services/approvalPolicyEngine').composeShadowRoute(hydrated,{requestType:'Non-Stock',departmentClassification:'Medical',isStockRequest:false,estimatedAmount:'25200000'},{});
  expect(route.matchedRules).toEqual([{code:'NONSTOCK_MED_HIGH',priority:1}]);
});
test('historical run retrieval returns its recorded diagnostics without evaluating current policy data',async()=>{
  const summary={policy:{versionId:12,versionNumber:1},ruleDiagnostics:[{code:'OLD_RULE',result:'NO MATCH',conditions:[]}]};
  mockRepo.getShadowRun.mockResolvedValue({rows:[{id:3,summary}]});
  mockRepo.getShadowSteps.mockResolvedValue({rows:[]});mockRepo.getShadowDifferences.mockResolvedValue({rows:[]});
  const run=await service.getShadowRun(3,actor);
  expect(run.summary).toEqual(summary);
  expect(mockRepo.getVersion).not.toHaveBeenCalled();
});
test('body instituteId cannot override actor scope when creating a policy',async()=>{mockQuery.mockImplementation(async sql=>sql==='BEGIN'||sql==='COMMIT'?{rows:[]}:sql.startsWith('INSERT INTO approval_policies')?{rows:[{id:1,institute_id:10}]}:{rows:[]});await service.createPolicy({code:'A',name:'A',instituteId:999},actor);const insert=mockQuery.mock.calls.find(x=>x[0].startsWith('INSERT INTO approval_policies'));expect(insert[1][0]).toBe(10);expect(insert[1]).not.toContain(999)});
test.each(['SHADOW','ACTIVE','RETIRED'])('%s configuration replacement is rejected and rolled back',async status=>{mockRepo.getVersion.mockResolvedValue({rows:[{id:4,status}]});await expect(service.replaceDraft(4,{rules:[]},actor)).rejects.toMatchObject({statusCode:409});expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');expect(mockQuery.mock.calls.some(x=>String(x[0]).startsWith('DELETE FROM approval_policy_rules'))).toBe(false)});
test('DRAFT validates to VALIDATED and VALIDATED enters SHADOW',async()=>{mockRepo.getVersion.mockResolvedValueOnce({rows:[{id:4,status:'DRAFT',policy:{instituteId:10}}]}).mockResolvedValueOnce({rows:[{id:4,status:'VALIDATED',policy:{instituteId:10}}]});mockRepo.listRules.mockResolvedValue({rows:[{id:8,rule_code:'R',priority:1}]});mockRepo.listSteps.mockResolvedValue({rows:[{approvalLevel:1,stepOrder:1,resolverType:'REQUESTER',semanticKey:'REQUESTER',displayName:'Requester'}]});await expect(service.validate(4,actor)).resolves.toMatchObject({valid:true});mockQuery.mockImplementation(async sql=>String(sql).includes("status='SHADOW'")?{rows:[{id:4,status:'SHADOW'}]}:{rows:[],rowCount:0});await expect(service.enterShadow(4,actor)).resolves.toMatchObject({status:'SHADOW'})});
test.each(['rule','condition','step'])('replaceDraft rolls back completely when %s persistence fails',async failure=>{mockRepo.getVersion.mockResolvedValue({rows:[{id:4,status:'DRAFT',policy:{instituteId:10}}]});mockQuery.mockImplementation(async sql=>{if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};if((failure==='rule'&&sql.startsWith('INSERT INTO approval_policy_rules'))||(failure==='condition'&&sql.startsWith('INSERT INTO approval_policy_rule_conditions'))||(failure==='step'&&sql.startsWith('INSERT INTO approval_policy_rule_steps')))throw new Error(`${failure} failed`);if(sql.startsWith('INSERT INTO approval_policy_rules'))return {rows:[{id:8}]};return {rows:[]}});const body={rules:[{code:'R',name:'Rule',priority:1,conditions:[{type:'REQUEST_TYPE_EQUALS',value:'PR'}],steps:[{stepOrder:1,approvalLevel:1,semanticKey:'X',displayName:'X',resolverType:'REQUESTER'}]}]};await expect(service.replaceDraft(4,body,actor)).rejects.toThrow(`${failure} failed`);expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');expect(mockQuery).not.toHaveBeenCalledWith('COMMIT')});
test('replaceDraft identifies the exact approval step with missing metadata',async()=>{await expect(service.replaceDraft(4,{rules:[{code:'R',name:'Rule',priority:1,conditions:[],steps:[{stepOrder:1,approvalLevel:1,semanticKey:' ',displayName:'Department',resolverType:'DEPARTMENT_HEAD'}]}]},actor)).rejects.toMatchObject({statusCode:422,message:'Routing rule 1, step 1: semantic key is required'});expect(mockConnect).not.toHaveBeenCalled()});
test('runShadow verifies scoped version and request before invoking isolated generator',async()=>{mockRepo.getVersion.mockResolvedValue({rows:[{id:4,status:'SHADOW',policy:{instituteId:10}}]});mockQuery.mockResolvedValue({rows:[{id:7}]});shadow.generateShadowApprovalRoute.mockResolvedValue({run:{id:1}});await service.runShadow(7,4,actor);expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('institute_id=$2'),[7,10]);expect(shadow.generateShadowApprovalRoute).toHaveBeenCalledWith(7,4,1,expect.objectContaining({instituteId:10}))});
test('batch clamps limit, scopes every filter mockQuery, and never evaluates unselected history',async()=>{mockRepo.getVersion.mockResolvedValue({rows:[{id:4,status:'SHADOW',policy:{instituteId:10}}]});mockQuery.mockResolvedValue({rows:[]});const result=await service.runShadowBatch({policyVersionId:4,dateFrom:'2026-01-01',dateTo:'2026-02-01',departmentId:5,requestType:'PR',limit:999,cursor:'20',instituteId:999},actor).catch(e=>e);expect(result.statusCode).toBe(400);await service.runShadowBatch({policyVersionId:4,dateFrom:'2026-01-01',dateTo:'2026-02-01',departmentId:5,requestType:'PR',limit:999,cursor:'20'},actor);const call=mockQuery.mock.calls.find(x=>String(x[0]).includes('SELECT id FROM requests'));expect(call[1]).toEqual([10,'2026-01-01','2026-02-01',5,'PR',100,20])});
