const organizationRepository=require('../repositories/organizationRepository');
const {effective}=require('./organizationService');
const writeAuditEvent=require('./auditService').writeAuditEvent;

const httpError=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
function createOrganizationReconciliationService(repo=organizationRepository,audit=writeAuditEvent){
  const discover=(departmentId,instituteId,client)=>repo.legacyHeadCandidates(departmentId,instituteId,client);
  const rowFor=async(unit,instituteId,client)=>{
    const legacy=(await discover(unit.department_id,instituteId,client)).filter(x=>x.is_active!==false);
    const heads=(await repo.positions(unit.id,client)).filter(x=>x.position_type==='DEPARTMENT_HEAD'&&effective(x));
    let status,suggestedAction;
    if(heads.length>1){status='AMBIGUOUS_ORG_HEAD';suggestedAction='Resolve duplicate organization heads';}
    else if(legacy.length>1){status='MULTIPLE_LEGACY_HODS';suggestedAction='Choose Different User';}
    else if(!heads.length&&!legacy.length){status='ORG_HEAD_MISSING';suggestedAction='Manual assignment required';}
    else if(!heads.length){status='ORG_HEAD_MISSING';suggestedAction='Assign Suggested Head';}
    else if(!legacy.length){status='LEGACY_HOD_MISSING';suggestedAction='Keep Existing Organization Head';}
    else if(String(heads[0].user_id)===String(legacy[0].id)){status='MATCHED';suggestedAction='No action required';}
    else{status='CONFLICT';suggestedAction='Review conflict';}
    return{department:{id:unit.department_id,name:unit.department_name||unit.name},unitId:unit.id,legacyCandidates:legacy,currentOrganizationHead:heads[0]||null,status,suggestedAction,safeToAssign:legacy.length===1&&!heads.length&&legacy[0].is_active!==false};
  };
  const list=async instituteId=>Promise.all((await repo.list({institute:instituteId,type:'DEPARTMENT',active:true})).map(u=>rowFor(u,instituteId)));
  const assign=async({instituteId,unitId,userId,actorId,reason,fromLegacy=false})=>{
    const unit=await repo.get(unitId);if(!unit||String(unit.institute_id)!==String(instituteId)||unit.unit_type!=='DEPARTMENT')throw httpError(404,'Department organization unit not found');
    const rows=await list(instituteId),row=rows.find(x=>String(x.unitId)===String(unitId));
    if(fromLegacy&&(!row?.safeToAssign||String(row.legacyCandidates[0].id)!==String(userId)))throw httpError(409,'Legacy assignment is not an unambiguous safe match');
    return {unit,row,userId,actorId,reason};
  };
  const bulkPreview=async instituteId=>(await list(instituteId)).filter(x=>x.safeToAssign);
  return{getLegacyDepartmentHeadCandidates:discover,list,rowFor,assign,bulkPreview,repo,audit};
}
module.exports={createOrganizationReconciliationService};