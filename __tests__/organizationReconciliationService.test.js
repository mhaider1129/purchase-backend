const {createOrganizationReconciliationService}=require('../services/organizationReconciliationService');
const unit={id:4,name:'Nursing',department_name:'Nursing',department_id:10,unit_type:'DEPARTMENT',institute_id:1,is_active:true};
const build=(legacy=[],heads=[])=>createOrganizationReconciliationService({list:jest.fn(async()=>[unit]),get:jest.fn(async()=>unit),positions:jest.fn(async()=>heads),legacyHeadCandidates:jest.fn(async()=>legacy)});
test.each([
 [[],[],'ORG_HEAD_MISSING',false],
 [[{id:1,name:'HOD',is_active:true,evidence:['users.role=HOD']}],[],'ORG_HEAD_MISSING',true],
 [[{id:1,is_active:true},{id:2,is_active:true}],[],'MULTIPLE_LEGACY_HODS',false],
 [[{id:1,is_active:true}],[{user_id:1,position_type:'DEPARTMENT_HEAD',is_active:true}],'MATCHED',false],
 [[{id:1,is_active:true}],[{user_id:2,position_type:'DEPARTMENT_HEAD',is_active:true}],'CONFLICT',false],
 [[],[{user_id:2,position_type:'DEPARTMENT_HEAD',is_active:true}],'LEGACY_HOD_MISSING',false]
])('classifies reconciliation %#',async(legacy,heads,status,safe)=>{const [row]=await build(legacy,heads).list(1);expect(row).toMatchObject({status,safeToAssign:safe})});
test('bulk preview includes only unambiguous active same-scope candidates',async()=>{const service=build([{id:1,is_active:true}],[]);expect(await service.bulkPreview(1)).toHaveLength(1);await expect(service.assign({instituteId:1,unitId:4,userId:2,fromLegacy:true})).rejects.toMatchObject({statusCode:409})});
test('foreign institute reconciliation fails closed',async()=>{const service=build([{id:1,is_active:true}],[]);await expect(service.assign({instituteId:2,unitId:4,userId:1})).rejects.toMatchObject({statusCode:404})});
test('inactive legacy HOD remains evidence but is never safe to assign',async()=>{const [row]=await build([{id:1,is_active:false,evidence:['users.role=HOD']}],[]).list(1);expect(row.legacyCandidates).toHaveLength(1);expect(row.safeToAssign).toBe(false);expect(row.suggestedAction).toBe('Manual assignment required')});
test('a durable decision resolves the same legacy conflict deterministically',async()=>{const legacy=[{id:1,is_active:true}],heads=[{user_id:2,position_type:'DEPARTMENT_HEAD',is_active:true}];const repo={list:jest.fn(async()=>[unit]),get:jest.fn(async()=>unit),positions:jest.fn(async()=>heads),legacyHeadCandidates:jest.fn(async()=>legacy),reconciliationDecision:jest.fn(async()=>({id:9,legacy_user_id:1,decision:'MARK_LEGACY_OBSOLETE'}))};const [row]=await createOrganizationReconciliationService(repo,jest.fn()).list(1);expect(row).toMatchObject({status:'NO_ACTION_REQUIRED',safeToAssign:false,decision:{decision:'MARK_LEGACY_OBSOLETE'}})});