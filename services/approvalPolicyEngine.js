const LIVE_ROUTING_ENABLED = false;

const CONDITION_TYPES = Object.freeze(['REQUEST_TYPE_EQUALS','DEPARTMENT_EQUALS','SECTION_EQUALS','DEPARTMENT_CLASSIFICATION_EQUALS','ORGANIZATION_ANCESTOR_EQUALS','AMOUNT_GTE','AMOUNT_LT','IS_STOCK_REQUEST','IS_NON_STOCK_REQUEST','IS_MAINTENANCE_REQUEST','IS_MEDICAL_DEVICE_REQUEST','IS_MEDICAL_REQUEST','WAREHOUSE_REQUIRED']);
const RESOLVER_TYPES = Object.freeze(['REQUESTER','DEPARTMENT_HEAD','SECTION_HEAD','EXECUTIVE_OWNER','POSITION','CAPABILITY_HOLDER','FIXED_USER','FIXED_AUTHORITY','SUPPLY_CHAIN_AUTHORITY','COO_AUTHORITY','CEO_AUTHORITY','CFO_AUTHORITY','WAREHOUSE_AUTHORITY','MEDICAL_DEVICES_AUTHORITY']);
const capabilityAliases = { SUPPLY_CHAIN_AUTHORITY:'approval-authority.supply-chain', COO_AUTHORITY:'approval-authority.coo', CEO_AUTHORITY:'approval-authority.ceo', CFO_AUTHORITY:'approval-authority.cfo', WAREHOUSE_AUTHORITY:'approval-authority.warehouse', MEDICAL_DEVICES_AUTHORITY:'approval-authority.medical-devices' };

// Decimal strings are compared without IEEE-754 conversion.
function decimalCompare(a, b) {
  const normal = value => { const match=String(value).trim().match(/^([+-])?(\d+)(?:\.(\d+))?$/); if(!match) throw new Error('Invalid decimal'); const sign=match[1]==='-'?-1:1; const whole=match[2].replace(/^0+(?=\d)/,''); const fraction=(match[3]||'').replace(/0+$/,''); return {sign,whole,fraction}; };
  const x=normal(a), y=normal(b); if(x.sign!==y.sign) return x.sign-y.sign;
  const magnitude=x.whole.length-y.whole.length || x.whole.localeCompare(y.whole) || x.fraction.padEnd(Math.max(x.fraction.length,y.fraction.length),'0').localeCompare(y.fraction.padEnd(Math.max(x.fraction.length,y.fraction.length),'0'));
  return Math.sign(magnitude)*x.sign;
}

function evaluateCondition(condition, facts) {
  const value=condition.value; let actual;
  const fields={REQUEST_TYPE_EQUALS:'requestType',DEPARTMENT_EQUALS:'departmentId',SECTION_EQUALS:'sectionId',DEPARTMENT_CLASSIFICATION_EQUALS:'departmentClassification'};
  if(fields[condition.type]) { actual=facts[fields[condition.type]]; return actual==null?'UNKNOWN':String(actual)===String(value); }
  if(condition.type==='ORGANIZATION_ANCESTOR_EQUALS') return facts.organizationAncestorIds==null?'UNKNOWN':facts.organizationAncestorIds.map(String).includes(String(value));
  if(condition.type==='AMOUNT_GTE'||condition.type==='AMOUNT_LT') return facts.estimatedAmount==null?'UNKNOWN':condition.type==='AMOUNT_GTE'?decimalCompare(facts.estimatedAmount,value)>=0:decimalCompare(facts.estimatedAmount,value)<0;
  const booleans={IS_STOCK_REQUEST:['isStockRequest',true],IS_NON_STOCK_REQUEST:['isStockRequest',false],IS_MAINTENANCE_REQUEST:['isMaintenanceRequest',true],IS_MEDICAL_DEVICE_REQUEST:['isMedicalDeviceRequest',true],IS_MEDICAL_REQUEST:['isMedicalRequest',true],WAREHOUSE_REQUIRED:['warehouseRequired',true]};
  if(booleans[condition.type]) { actual=facts[booleans[condition.type][0]]; return actual==null?'UNKNOWN':actual===booleans[condition.type][1]; }
  throw new Error(`Unsupported condition: ${condition.type}`);
}

function validateVersion(version) {
  const errors=[], warnings=[]; if(!version?.policy) errors.push('Policy is required'); if(!version?.rules?.length) errors.push('At least one rule is required');
  const priorities=new Set(); for(const rule of version?.rules||[]) { if(!Number.isInteger(rule.priority)||priorities.has(rule.priority)) errors.push(`Rule priority must be a unique integer: ${rule.code}`); priorities.add(rule.priority);
    for(const c of rule.conditions||[]) if(!CONDITION_TYPES.includes(c.type)||c.value===undefined) errors.push(`Invalid condition in ${rule.code}`);
    const configured=new Set(); for(const s of rule.steps||[]) { if(!RESOLVER_TYPES.includes(s.resolverType)) errors.push(`Invalid resolver in ${rule.code}`); if(!Number.isInteger(s.approvalLevel)||s.approvalLevel<1||!Number.isInteger(s.stepOrder)||s.stepOrder<1) errors.push(`Invalid step order/level in ${rule.code}`); if(!s.semanticKey) errors.push(`Semantic key required in ${rule.code}`); const key=`${s.approvalLevel}|${s.semanticKey}|${s.resolverType}|${s.resolverReference||''}`; if(configured.has(key)) errors.push(`Duplicate semantic step configuration in ${rule.code}`); configured.add(key); if(['POSITION','CAPABILITY_HOLDER','FIXED_USER','FIXED_AUTHORITY'].includes(s.resolverType)&&!s.resolverReference) errors.push(`Resolver reference required in ${rule.code}`); }
  } return {valid:errors.length===0,errors,warnings};
}

async function resolveStep(step, facts, dependencies) {
  let result;
  try {
    if(step.resolverType==='REQUESTER') result={userId:facts.requesterId,userName:facts.requesterName,source:'REQUEST'};
    else if(step.resolverType==='DEPARTMENT_HEAD') result=await dependencies.organization.resolveDepartmentHead(facts.departmentId);
    else if(step.resolverType==='SECTION_HEAD') result=await dependencies.organization.resolveSectionHead(facts.sectionId);
    else if(step.resolverType==='EXECUTIVE_OWNER') result=await dependencies.organization.resolveExecutiveOwner(facts.departmentId);
    else if(step.resolverType==='POSITION') result=await dependencies.organization.resolvePosition(step.resolverReference,facts.instituteId);
    else if(step.resolverType==='FIXED_USER'||step.resolverType==='FIXED_AUTHORITY') result=await dependencies.resolveFixedUser(step.resolverReference,facts.instituteId);
    else result=await dependencies.resolveCapability(capabilityAliases[step.resolverType]||step.resolverReference,facts.instituteId);
  } catch(error) { if(error.statusCode===409) return {...step,resolutionStatus:'AMBIGUOUS',resolutionReason:error.message}; throw error; }
  if(Array.isArray(result)) return result.length===1?{...step,...result[0],resolutionStatus:'RESOLVED'}:result.length>1?{...step,resolutionStatus:'AMBIGUOUS',resolutionReason:'Multiple active authority holders'}:{...step,resolutionStatus:'UNRESOLVED',resolutionReason:'No active authority holder'};
  return result?.userId||result?.user_id?{...step,userId:result.userId||result.user_id,userName:result.userName||result.user_name,unitId:result.unitId,resolutionSource:result.source||step.resolverType,resolutionStatus:'RESOLVED'}:{...step,resolutionStatus:'UNRESOLVED',resolutionReason:'No active authority holder'};
}

async function composeShadowRoute(version, facts, dependencies) {
  const matchedRules=[]; for(const rule of [...version.rules].filter(r=>r.isActive!==false).sort((a,b)=>a.priority-b.priority)) { const results=(rule.conditions||[]).map(c=>evaluateCondition(c,facts)); if(results.every(Boolean)&&!results.includes('UNKNOWN')) { matchedRules.push(rule); if(rule.stopProcessing) break; } }
  const candidates=matchedRules.flatMap(rule=>(rule.steps||[]).map(step=>({...step,ruleCode:rule.code}))).sort((a,b)=>a.approvalLevel-b.approvalLevel||a.stepOrder-b.stepOrder||a.ruleCode.localeCompare(b.ruleCode));
  const resolved=[]; for(const candidate of candidates) resolved.push(await resolveStep(candidate,facts,dependencies));
  const seen=new Set(), steps=[]; for(const step of resolved) { const key=step.resolutionStatus==='RESOLVED'?`${step.userId}|${step.semanticKey}`:null; if(key&&seen.has(key)) steps.push({...step,resolutionStatus:'DEDUPLICATED',resolutionReason:'Same principal and semantic key'}); else { if(key) seen.add(key); steps.push(step); } }
  return {facts,matchedRules:matchedRules.map(r=>({code:r.code,priority:r.priority})),steps,warnings:[],errors:[]};
}

function normalizeCurrentRoute(rows) { return rows.map((r,index)=>({sequence:r.sequence??index+1,approvalLevel:r.approval_level??r.approvalLevel,userId:r.approver_id??r.userId,userName:r.approver_name??r.userName,status:r.status,semanticKey:'LEGACY_SEMANTIC_UNKNOWN',routeVersion:r.route_version??null})); }
function compareApprovalRoutes(current, shadow) {
  const differences=[], usedCurrent=new Set(), usedShadow=new Set();
  const comparable=shadow.map((step,index)=>({step,index})).filter(({step})=>step.resolutionStatus==='RESOLVED');
  for(const {step,index} of shadow.map((step,index)=>({step,index}))){
    if(step.resolutionStatus==='AMBIGUOUS') differences.push({type:'AMBIGUOUS_RESOLUTION',shadowIndex:index});
    if(step.resolutionStatus==='UNRESOLVED') differences.push({type:'UNRESOLVED_RESOLUTION',shadowIndex:index});
  }

  // Legacy routes do not carry reliable semantics. Pair steps by the strongest
  // structural evidence first, then use principal identity as supporting evidence.
  // This deliberately allows a structurally equivalent step to report a changed
  // principal instead of degrading into an added/missing pair.
  const candidates=[];
  for(const {step:s,index:i} of comparable) for(let j=0;j<current.length;j++){
    const c=current[j];
    const reliableSemantic=c.semanticKey&&s.semanticKey&&c.semanticKey!=='LEGACY_SEMANTIC_UNKNOWN'&&s.semanticKey!=='LEGACY_SEMANTIC_UNKNOWN';
    const semanticMatch=reliableSemantic&&c.semanticKey===s.semanticKey;
    const sameLevel=Number(c.approvalLevel)===Number(s.approvalLevel);
    const sameOrder=j===i;
    const samePrincipal=c.userId!=null&&s.userId!=null&&String(c.userId)===String(s.userId);
    const score=(semanticMatch?1000:0)+(samePrincipal?200:0)+(sameLevel?100:0)+(sameOrder?60:0)-Math.abs(j-i);
    candidates.push({i,j,score});
  }
  candidates.sort((a,b)=>b.score-a.score||Math.abs(a.j-a.i)-Math.abs(b.j-b.i)||a.i-b.i||a.j-b.j);
  for(const candidate of candidates){
    if(usedShadow.has(candidate.i)||usedCurrent.has(candidate.j))continue;
    usedShadow.add(candidate.i);usedCurrent.add(candidate.j);
    const c=current[candidate.j],s=shadow[candidate.i];
    const type=String(c.userId)!==String(s.userId)?'DIFFERENT_USER':Number(c.approvalLevel)!==Number(s.approvalLevel)?'DIFFERENT_LEVEL':candidate.j!==candidate.i?'DIFFERENT_ORDER':'MATCH';
    differences.push({type,currentIndex:candidate.j,shadowIndex:candidate.i});
  }
  comparable.forEach(({index})=>{if(!usedShadow.has(index))differences.push({type:'ADDED_BY_SHADOW',shadowIndex:index});});
  current.forEach((_,index)=>{if(!usedCurrent.has(index))differences.push({type:'MISSING_IN_SHADOW',currentIndex:index});});
  const principals=new Map(); shadow.filter(s=>s.resolutionStatus==='RESOLVED').forEach((s,i)=>{const prior=principals.get(String(s.userId));if(prior&&prior.semanticKey!==s.semanticKey)differences.push({type:'DUPLICATE_PRINCIPAL',shadowIndex:i,otherShadowIndex:prior.i});else principals.set(String(s.userId),{semanticKey:s.semanticKey,i});});
  const count=type=>differences.filter(d=>d.type===type).length;
  const metrics={currentStepCount:current.length,shadowStepCount:shadow.filter(s=>s.resolutionStatus!=='DEDUPLICATED').length,matchedCount:count('MATCH'),addedCount:count('ADDED_BY_SHADOW'),missingCount:count('MISSING_IN_SHADOW'),differentUserCount:count('DIFFERENT_USER'),unresolvedCount:count('UNRESOLVED_RESOLUTION'),ambiguousCount:count('AMBIGUOUS_RESOLUTION')};
  const result=metrics.unresolvedCount||metrics.ambiguousCount?'UNRESOLVED':differences.every(d=>['MATCH','DUPLICATE_PRINCIPAL'].includes(d.type))?'MATCH':metrics.matchedCount?'PARTIAL_MATCH':'DIFFERENT';
  return {result,differences,metrics};
}

module.exports={LIVE_ROUTING_ENABLED,CONDITION_TYPES,RESOLVER_TYPES,CAPABILITY_ALIASES:capabilityAliases,decimalCompare,evaluateCondition,validateVersion,composeShadowRoute,normalizeCurrentRoute,compareApprovalRoutes};