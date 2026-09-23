const pool=require('../config/db');
const failure=(statusCode,message,code)=>Object.assign(new Error(message),{statusCode,code});

/** Internal-only append API. It is intentionally not connected to request submission
 * while Approval Engine 2.0 live routing is disabled. */
async function createGeneration(input,actor,client){
  if(!client)throw new TypeError('createGeneration requires a transaction client');
  if(!actor?.instituteId)throw failure(403,'Institute context is required','INSTITUTE_CONTEXT_REQUIRED');
  if(!Number.isInteger(input.generationNumber)||input.generationNumber<1)throw failure(422,'generationNumber must be a positive integer','INVALID_SNAPSHOT_GENERATION');
  const snapshot=(await client.query(`INSERT INTO approval_route_snapshots
    (institute_id,request_id,policy_id,policy_version_id,generation_number,supersedes_snapshot_id,generation_reason,facts_snapshot,route_generation_context,generated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[actor.instituteId,input.requestId,input.policyId,input.policyVersionId,input.generationNumber,
    input.supersedesSnapshotId||null,input.generationReason||null,input.factsSnapshot,input.routeGenerationContext||{},actor.id])).rows[0];
  for(const [index,step] of (input.steps||[]).entries()){
    await client.query(`INSERT INTO approval_route_snapshot_steps
      (snapshot_id,policy_rule_id,policy_step_id,sequence,approval_level,parallel_group,semantic_key,required_authority,resolved_unit_id,resolved_position_id,structural_holder_id,acting_approver_id,delegation_id,resolution_type,resolution_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[snapshot.id,step.policyRuleId||null,step.policyStepId||null,step.sequence||index+1,step.approvalLevel,step.parallelGroup||null,
      step.semanticKey,step.requiredAuthority,step.resolvedUnitId||null,step.resolvedPositionId||null,step.structuralHolderId||null,step.actingApproverId||null,step.delegationId||null,step.resolutionType,step.resolutionReason||null]);
  }
  return snapshot;
}
async function createGenerationTransaction(input,actor){const client=await pool.connect();try{await client.query('BEGIN');const result=await createGeneration(input,actor,client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');if(error.code==='23505')throw failure(409,'Snapshot generation already exists','SNAPSHOT_GENERATION_CONFLICT');throw error;}finally{client.release();}}
module.exports={createGeneration,createGenerationTransaction};