const pool=require('../config/db');
const audit=require('./auditService').writeAuditEvent;
const failure=(statusCode,message,code)=>Object.assign(new Error(message),{statusCode,code});
const actorScope=actor=>{if(!actor?.instituteId)throw failure(403,'Institute context is required','INSTITUTE_CONTEXT_REQUIRED');return actor.instituteId;};
async function transaction(work){const c=await pool.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
async function list(actor){const instituteId=actorScope(actor);return (await pool.query(`SELECT d.*,du.name delegate_user_name,ou.name authority_unit_name,op.position_name FROM approval_authority_delegations d JOIN users du ON du.id=d.delegate_user_id LEFT JOIN organization_positions op ON op.id=d.organization_position_id LEFT JOIN organization_units ou ON ou.id=op.organization_unit_id WHERE d.institute_id=$1 ORDER BY d.effective_from DESC`,[instituteId])).rows;}

const boundedPeriod=body=>{
  const from=new Date(body.effectiveFrom),to=new Date(body.effectiveTo);
  if(!body.effectiveFrom||!body.effectiveTo||Number.isNaN(from.valueOf())||Number.isNaN(to.valueOf())||to<=from)throw failure(400,'A valid non-empty bounded effective period is required','INVALID_DELEGATION_PERIOD');
  return {from,to};
};
const covers=(position,from,to)=>{
  const starts=position.effective_from?new Date(position.effective_from):null;
  /* Organization positions use inclusive date bounds. A delegation's half-open
     timestamp range must end no later than the end of the holder's final day. */
  const ends=position.effective_to?new Date(`${String(position.effective_to).slice(0,10)}T23:59:59.999Z`):null;
  return (!starts||starts<=from)&&(!ends||ends>=to);
};

async function create(body,actor){
  const instituteId=actorScope(actor),period=boundedPeriod(body);
  if(!body.scope||!body.reason?.trim())throw failure(400,'Scope and reason are required','INVALID_DELEGATION');
  if(!body.delegatorUserId&&!body.organizationPositionId)throw failure(400,'Delegator or structural position is required','INVALID_DELEGATION_AUTHORITY');
  if(!body.delegateUserId)throw failure(400,'Delegate is required','INVALID_DELEGATION');
  return transaction(async c=>{
    const delegate=(await c.query('SELECT id FROM users WHERE id=$1 AND institute_id=$2 AND COALESCE(is_active,true)',[body.delegateUserId,instituteId])).rows[0];
    if(!delegate)throw failure(422,'Delegate must be active in the same institute','INVALID_DELEGATE');
    let authorityUserId=body.delegatorUserId||null;
    if(body.organizationPositionId){
      const position=(await c.query(`SELECT op.user_id,op.is_active,op.effective_from,op.effective_to,ou.is_active unit_active,u.id holder_id,u.institute_id holder_institute_id,u.is_active holder_active
        FROM organization_positions op JOIN organization_units ou ON ou.id=op.organization_unit_id
        LEFT JOIN users u ON u.id=op.user_id WHERE op.id=$1 AND ou.institute_id=$2`,[body.organizationPositionId,instituteId])).rows[0];
      if(!position)throw failure(422,'Structural authority must belong to the same institute','INVALID_STRUCTURAL_AUTHORITY');
      if(!position.unit_active)throw failure(422,'Structural authority unit is inactive','INACTIVE_AUTHORITY_UNIT');
      if(!position.is_active||!covers(position,period.from,period.to))throw failure(422,'Structural authority is not effective for the full delegation period','AUTHORITY_PERIOD_NOT_COVERED');
      if(!position.holder_id||!position.holder_active||String(position.holder_institute_id)!==String(instituteId))throw failure(422,'Structural authority requires an active same-institute holder','INVALID_STRUCTURAL_HOLDER');
      authorityUserId=position.user_id;
    }else{
      const owner=(await c.query('SELECT id FROM users WHERE id=$1 AND institute_id=$2 AND COALESCE(is_active,true)',[authorityUserId,instituteId])).rows[0];
      if(!owner)throw failure(422,'Delegator must be active in the same institute','INVALID_DELEGATOR');
    }
    if(String(authorityUserId)===String(body.delegateUserId))throw failure(400,'Self-delegation is not permitted','SELF_DELEGATION');
    if(body.delegatorUserId&&String(authorityUserId)!==String(body.delegatorUserId))throw failure(422,'Delegator is not the structural position holder','POSITION_HOLDER_MISMATCH');

    /* Phase 1 is deliberately one hop. A user acting as a delegate during any
       part of this period cannot originate another delegation, and inverse
       edges are rejected to prevent loops. */
    const chain=(await c.query(`SELECT id FROM approval_authority_delegations
      WHERE institute_id=$1 AND status='ACTIVE' AND effective_period && tstzrange($2,$3,'[)')
      AND (delegate_user_id=$4 OR (organization_position_id IS NULL AND delegator_user_id=$5 AND delegate_user_id=$4)) LIMIT 1`,
      [instituteId,body.effectiveFrom,body.effectiveTo,authorityUserId,body.delegateUserId])).rows[0];
    if(chain)throw failure(409,'Delegated authority cannot be redelegated or form a loop','DELEGATION_CHAIN_NOT_SUPPORTED');

    try{
      const row=(await c.query(`INSERT INTO approval_authority_delegations(institute_id,organization_position_id,delegator_user_id,delegate_user_id,effective_from,effective_to,scope,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[instituteId,body.organizationPositionId||null,authorityUserId,body.delegateUserId,body.effectiveFrom,body.effectiveTo,body.scope,body.reason.trim(),actor.id])).rows[0];
      await audit({client:c,entityType:'approval_authority_delegation',entityId:row.id,action:'APPROVAL_AUTHORITY_DELEGATED',actorUserId:actor.id,afterData:row});return row;
    }catch(error){if(error.code==='23P01'||error.constraint==='approval_delegation_no_overlap_excl')throw failure(409,'An overlapping delegation already exists for this authority and scope','DELEGATION_PERIOD_CONFLICT');throw error;}
  });
}
async function revoke(id,body,actor){const instituteId=actorScope(actor);if(!body.reason?.trim())throw failure(400,'Revocation reason is required');return transaction(async c=>{const before=(await c.query("SELECT * FROM approval_authority_delegations WHERE id=$1 AND institute_id=$2 AND status='ACTIVE' FOR UPDATE",[id,instituteId])).rows[0];if(!before)throw failure(404,'Active delegation not found');const row=(await c.query("UPDATE approval_authority_delegations SET status='REVOKED',revoked_by=$3,revoked_at=now(),revocation_reason=$4,row_version=row_version+1 WHERE id=$1 AND institute_id=$2 RETURNING *",[id,instituteId,actor.id,body.reason.trim()])).rows[0];await audit({client:c,entityType:'approval_authority_delegation',entityId:id,action:'APPROVAL_AUTHORITY_DELEGATION_REVOKED',actorUserId:actor.id,beforeData:before,afterData:row});return row;});}
async function resolve(input,client=pool){const at=input.at||new Date();const rows=(await client.query(`SELECT d.id,d.delegate_user_id "delegateUserId",u.name "delegateUserName" FROM approval_authority_delegations d JOIN users u ON u.id=d.delegate_user_id AND u.institute_id=d.institute_id AND COALESCE(u.is_active,true) WHERE d.institute_id=$1 AND d.scope=$2 AND d.status='ACTIVE' AND d.effective_from<=$5 AND d.effective_to>$5 AND (($3::bigint IS NOT NULL AND d.organization_position_id=$3) OR ($3::bigint IS NULL AND d.organization_position_id IS NULL AND d.delegator_user_id=$4))`,[input.instituteId,input.scope,input.positionId||null,input.delegatorUserId,at])).rows;return rows.length>1?{ambiguous:true}:rows[0]||null;}
module.exports={list,create,revoke,resolve,transaction,boundedPeriod,covers};