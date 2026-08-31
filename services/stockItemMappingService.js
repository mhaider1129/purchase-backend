const { codedError } = require('./inventoryItemCreationService');
const StockItemMappingRepository = require('../repositories/stockItemMappingRepository');
const ItemMasterRepository = require('../repositories/itemMasterRepository');
const TRANSITIONS = Object.freeze({
  proposed: new Set(['review_required','rejected','duplicate','obsolete','excluded']),
  review_required: new Set(['approved','rejected','duplicate','obsolete','excluded']),
  approved: new Set(['superseded','rolled_back']),
});
function pagination(input={}) { const limit=Math.min(Math.max(Number(input.limit)||25,1),100); const page=Math.max(Number(input.page)||1,1); return {limit,offset:(page-1)*limit,page}; }
class StockItemMappingService {
  constructor(db) { this.db=db; }
  async list(filters={}) { const p=pagination(filters); const rows=await new StockItemMappingRepository(this.db).queue({status:filters.mapping_status||filters.status,stockItemId:filters.stock_item_id,genericItemId:filters.generic_item_id,category:filters.category,subcategory:filters.subcategory,uom:filters.uom,manufacturer:filters.manufacturer,identitySource:filters.identity_source},p); return {data:rows.map(({total_count,...row})=>row),pagination:{page:p.page,limit:p.limit,total:rows[0]?.total_count||0}}; }
  async detail(mappingId) { const row=await new StockItemMappingRepository(this.db).findById(mappingId); if(!row)throw codedError(404,'mapping_target_invalid','Mapping was not found'); return row; }
  async history(stockItemId,filters={}) { const p=pagination(filters); const rows=await new StockItemMappingRepository(this.db).list({status:filters.mapping_status||filters.status,stockItemId,genericItemId:filters.generic_item_id},p); return {data:rows.map(({total_count,...row})=>row),pagination:{page:p.page,limit:p.limit,total:rows[0]?.total_count||0}}; }
  async coverage() { return new StockItemMappingRepository(this.db).coverage(); }
  async propose(input,actorId) { if(!input.stock_item_id||!input.generic_item_id)throw codedError(400,'mapping_target_invalid','Stock Item and Generic Item are required'); const client=await this.db.connect();try{await client.query('BEGIN');const master=new ItemMasterRepository(client);if(!await master.findGeneric(input.generic_item_id))throw codedError(400,'mapping_target_invalid','Generic Item was not found');const row=await new StockItemMappingRepository(client).createProposal(input,actorId);await client.query('COMMIT');return row;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();} }
  async transition({stockItemId,mappingId,toStatus,expectedVersion,reason},actorId) {
    if (!Number.isInteger(expectedVersion)) throw codedError(400,'mapping_version_conflict','Expected version is required');
    if (!reason?.trim() && ['rejected','superseded','rolled_back','duplicate','obsolete','excluded'].includes(toStatus)) throw codedError(400,'mapping_transition_invalid','A reason is required');
    const client=await this.db.connect();
    try {
      await client.query('BEGIN'); const repo=new StockItemMappingRepository(client); const mapping=await repo.lockMapping(stockItemId,mappingId);
      if(!mapping)throw codedError(404,'mapping_target_invalid','Mapping was not found');
      if(mapping.version!==expectedVersion)throw codedError(409,'mapping_version_conflict','Mapping was changed by another reviewer');
      if(!TRANSITIONS[mapping.mapping_status]?.has(toStatus))throw codedError(409,'mapping_transition_invalid',`Cannot transition ${mapping.mapping_status} to ${toStatus}`);
      if(toStatus==='approved') { await this.validateTarget(client,mapping); await repo.deactivateOtherApprovals(stockItemId,mapping.id,actorId,'Replaced by approved mapping'); await repo.applyIdentity(stockItemId,mapping,actorId,reason); }
      const updated=await repo.transition(mapping,toStatus,actorId,reason);if(!updated)throw codedError(409,'mapping_version_conflict','Mapping was changed by another reviewer');
      await repo.audit(stockItemId,`mapping_${toStatus}`,actorId,reason,{mapping_id:mappingId,version:updated.version});await client.query('COMMIT');return updated;
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async validateTarget(client,mapping){const master=new ItemMasterRepository(client);const generic=await master.findGeneric(mapping.generic_item_id);if(!generic?.is_active)throw codedError(400,'mapping_target_invalid','Mapping Generic Item is inactive');if(mapping.approved_product_id){const product=await master.findProduct(mapping.approved_product_id);if(!product||product.generic_item_id!==generic.id||product.approval_status!=='approved'||!product.is_active)throw codedError(400,'mapping_target_invalid','Mapping Product is invalid');}}
  review(input,actorId){return this.transition({...input,toStatus:'review_required'},actorId);}
  approve(input,actorId){return this.transition({...input,toStatus:'approved'},actorId);}
  reject(input,actorId){return this.transition({...input,toStatus:'rejected'},actorId);}
  mark(input,status,actorId){return this.transition({...input,toStatus:status},actorId);}
  async replaceApproved(input, actorId, action) {
    if (input.mappingId !== input.expectedCurrentMappingId) throw codedError(409,'mapping_version_conflict','Current mapping changed');
    if (!input.reason?.trim()) throw codedError(400,'mapping_transition_invalid','A reason is required');
    const targetId = action === 'superseded' ? input.replacementMappingId : input.restoreMappingId;
    if (!Number.isInteger(targetId)) throw codedError(400,'mapping_target_invalid','Replacement mapping is required');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN'); const repo = new StockItemMappingRepository(client);
      const current = await repo.lockMapping(input.stockItemId,input.mappingId);
      const target = await repo.lockMapping(input.stockItemId,targetId);
      if (!current || current.mapping_status !== 'approved' || !current.active) throw codedError(409,'mapping_transition_invalid','Current mapping is not active and approved');
      if (current.version !== input.expectedVersion) throw codedError(409,'mapping_version_conflict','Mapping was changed by another reviewer');
      if (!target || (action === 'superseded' && !['proposed','review_required'].includes(target.mapping_status)) || (action === 'rolled_back' && !['superseded','rolled_back'].includes(target.mapping_status))) throw codedError(400,'mapping_target_invalid','Replacement mapping cannot be activated');
      await this.validateTarget(client,target);
      const ended = await repo.transition(current,action,actorId,input.reason); if(!ended)throw codedError(409,'mapping_version_conflict','Mapping was changed by another reviewer');
      const activated = await repo.transition(target,'approved',actorId,input.reason); if(!activated)throw codedError(409,'mapping_version_conflict','Replacement mapping was changed');
      await repo.applyIdentity(input.stockItemId,target,actorId,input.reason);
      await repo.audit(input.stockItemId,`mapping_${action}`,actorId,input.reason,{mapping_id:current.id,replacement_mapping_id:target.id});
      await client.query('COMMIT'); return {current_mapping:ended,active_mapping:activated};
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  supersede(input,actorId){return this.replaceApproved(input,actorId,'superseded');}
  rollback(input,actorId){return this.replaceApproved(input,actorId,'rolled_back');}
}
module.exports={TRANSITIONS,StockItemMappingService,pagination};