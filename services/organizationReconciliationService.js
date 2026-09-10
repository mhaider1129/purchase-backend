const organizationRepository=require('../repositories/organizationRepository');
const {effective}=require('./organizationService');
const writeAuditEvent=require('./auditService').writeAuditEvent;

const httpError=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
function createOrganizationReconciliationService(repo=organizationRepository,audit=writeAuditEvent){
  const discover=(departmentId,instituteId,client)=>repo.legacyHeadCandidates(departmentId,instituteId,client);
  const rowFor=async(unit,instituteId,client)=>{
    const legacy=await discover(unit.department_id,instituteId,client);
    const activeLegacy=legacy.filter(x=>x.is_active!==false);
    const heads=(await repo.positions(unit.id,client)).filter(x=>x.position_type==='DEPARTMENT_HEAD'&&effective(x));
    const decision=repo.reconciliationDecision?await repo.reconciliationDecision(unit.id,client):null;
    // A decision is evidence about one material conflict, not a permanent waiver.
    // Re-evaluate whenever either the legacy HOD or canonical head changes.
    const decisionApplies=decision&&activeLegacy.length===1&&heads.length===1&&
      String(decision.legacy_user_id)===String(activeLegacy[0].id)&&
      String(decision.organization_head_position_id)===String(heads[0].id)&&
      String(decision.organization_head_user_id)===String(heads[0].user_id);
    let status,suggestedAction;
    if(heads.length>1){status='AMBIGUOUS_ORG_HEAD';suggestedAction='Resolve duplicate organization heads';}
    else if(activeLegacy.length>1){status='MULTIPLE_LEGACY_HODS';suggestedAction='Choose Different User';}
    else if(decisionApplies&&heads.length){status='NO_ACTION_REQUIRED';suggestedAction='No action required';}
    else if(!heads.length&&!activeLegacy.length){status='ORG_HEAD_MISSING';suggestedAction='Manual assignment required';}
    else if(!heads.length){status='ORG_HEAD_MISSING';suggestedAction='Assign Suggested Head';}
    else if(!activeLegacy.length){status='LEGACY_HOD_MISSING';suggestedAction='Keep Existing Organization Head';}
    else if(String(heads[0].user_id)===String(activeLegacy[0].id)){status='MATCHED';suggestedAction='No action required';}
    else{status='CONFLICT';suggestedAction='Review conflict';}
    return{department:{id:unit.department_id,name:unit.department_name||unit.name},unitId:unit.id,legacyCandidates:legacy,currentOrganizationHead:heads[0]||null,status,suggestedAction,safeToAssign:activeLegacy.length===1&&!heads.length,decision:decisionApplies?decision:null};
  };
  const list=async(instituteId,client)=>Promise.all((await repo.list({institute:instituteId,type:'DEPARTMENT',active:true},client)).map(u=>rowFor(u,instituteId,client)));
  const lockedRow=async(unitId,instituteId,client)=>{
    if(!client)throw new TypeError('lockedRow requires a transaction client');
    const unit=await repo.get(unitId,client,{lock:true});
    if(!unit||String(unit.institute_id)!==String(instituteId)||unit.unit_type!=='DEPARTMENT'||unit.is_active===false)
      throw httpError(409,'Selected department is no longer an active organization unit in this institute');
    return rowFor(unit,instituteId,client);
  };
  const assign=async({instituteId,unitId,userId,actorId,reason,fromLegacy=false})=>{
    const unit=await repo.get(unitId);if(!unit||String(unit.institute_id)!==String(instituteId)||unit.unit_type!=='DEPARTMENT')throw httpError(404,'Department organization unit not found');
    const rows=await list(instituteId),row=rows.find(x=>String(x.unitId)===String(unitId));
    if(fromLegacy&&(!row?.safeToAssign||String(row.legacyCandidates[0].id)!==String(userId)))throw httpError(409,'Legacy assignment is not an unambiguous safe match');
    return {unit,row,userId,actorId,reason};
  };
  const bulkPreview=async instituteId=>(await list(instituteId)).filter(x=>x.safeToAssign);
  const decide=async({instituteId,unitId,decision,reason,actorId})=>{
    if(!['KEEP_EXISTING','MARK_LEGACY_OBSOLETE'].includes(decision))throw httpError(400,'Invalid reconciliation decision');
    if(!reason?.trim())throw httpError(400,'A reason is required');
    return repo.transaction(async client=>{
      // The unit row is the serialization lock for every decision on this unit.
      const unit=await repo.get(unitId,client,{lock:true});if(!unit||String(unit.institute_id)!==String(instituteId)||unit.unit_type!=='DEPARTMENT')throw httpError(404,'Department organization unit not found');
      const row=await rowFor(unit,instituteId,client);
      const activeLegacy=row.legacyCandidates.filter(x=>x.is_active!==false);
      if(!row.currentOrganizationHead)throw httpError(409,'An existing organization head is required for this decision');
      if(activeLegacy.length!==1)throw httpError(409,'Decision requires exactly one active legacy HOD');
      const saved=await repo.saveReconciliationDecision({instituteId,unitId,legacyUserId:activeLegacy[0].id,organizationHeadPositionId:row.currentOrganizationHead.id,organizationHeadUserId:row.currentOrganizationHead.user_id,decision,reason:reason.trim(),actorId},client);
      await audit({client,entityType:'organization_head_reconciliation_decision',entityId:saved.id,action:'ORGANIZATION_HEAD_CONFLICT_RESOLVED',actorUserId:actorId,instituteId,beforeData:{legacyCandidates:row.legacyCandidates,currentOrganizationHead:row.currentOrganizationHead,previousDecision:row.decision},afterData:saved,metadata:{reason:reason.trim()}});
      return saved;
    });
  };
  return{getLegacyDepartmentHeadCandidates:discover,list,rowFor,lockedRow,assign,bulkPreview,decide,repo,audit};
}
module.exports={createOrganizationReconciliationService};