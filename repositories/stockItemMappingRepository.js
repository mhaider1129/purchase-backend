class StockItemMappingRepository {
  constructor(client) { this.client = client; }
  async list(filters, pagination) {
    const values = []; const where = [];
    for (const [column, value] of [['mapping_status', filters.status], ['stock_item_id', filters.stockItemId], ['generic_item_id', filters.genericItemId]]) {
      if (value != null) { values.push(value); where.push(`m.${column} = $${values.length}`); }
    }
    values.push(pagination.limit, pagination.offset);
    const query = `SELECT m.*, count(*) OVER()::int AS total_count FROM stock_item_master_mappings m
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.updated_at DESC, m.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`;
    return (await this.client.query(query, values)).rows;
  }
  async coverage() {
    return (await this.client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE generic_item_id IS NOT NULL)::int AS mapped,
      count(*) FILTER (WHERE generic_item_id IS NULL)::int AS unmapped
      FROM stock_items`)).rows[0];
  }
  async findById(id) { return (await this.client.query('SELECT * FROM stock_item_master_mappings WHERE id=$1', [id])).rows[0] || null; }
  async lockMapping(stockItemId, mappingId) { return (await this.client.query('SELECT * FROM stock_item_master_mappings WHERE id=$1 AND stock_item_id=$2 FOR UPDATE', [mappingId, stockItemId])).rows[0] || null; }
  async createProposal(input, actorId) {
    return (await this.client.query(`INSERT INTO stock_item_master_mappings
      (stock_item_id,generic_item_id,approved_product_id,mapping_status,active,version,review_notes,created_by)
      VALUES($1,$2,$3,'proposed',false,1,$4,$5) RETURNING *`,
    [input.stock_item_id,input.generic_item_id,input.approved_product_id || null,input.reason || null,actorId])).rows[0];
  }
  async transition(mapping, status, actorId, reason) {
    const final = ['approved','rejected','superseded','rolled_back','duplicate','obsolete','excluded'].includes(status);
    return (await this.client.query(`UPDATE stock_item_master_mappings SET mapping_status=$1,active=$2,
      reviewed_by=CASE WHEN $3 THEN $4 ELSE reviewed_by END,reviewed_at=CASE WHEN $3 THEN now() ELSE reviewed_at END,
      review_notes=$5,version=version+1,updated_at=now() WHERE id=$6 AND version=$7 RETURNING *`,
    [status,status==='approved',final,actorId,reason,mapping.id,mapping.version])).rows[0] || null;
  }
  async deactivateOtherApprovals(stockItemId, exceptId, actorId, reason) {
    await this.client.query(`UPDATE stock_item_master_mappings SET active=false,mapping_status='superseded',
      reviewed_by=$3,reviewed_at=now(),review_notes=$4,version=version+1,updated_at=now()
      WHERE stock_item_id=$1 AND id<>$2 AND active=true AND mapping_status='approved'`, [stockItemId,exceptId,actorId,reason]);
  }
  async applyIdentity(stockItemId, mapping, actorId, reason) {
    await this.client.query(`UPDATE stock_items SET generic_item_id=$1,approved_product_id=$2,
      mapping_status=$3,identity_source='normalized',mapped_by=$4,mapped_at=now(),mapping_notes=$5 WHERE id=$6`,
    [mapping.generic_item_id,mapping.approved_product_id,mapping.approved_product_id?'mapped_product':'mapped_generic',actorId,reason,stockItemId]);
  }
  async audit(stockItemId, action, actorId, reason, values) {
    await this.client.query(`INSERT INTO item_master_audit_events(entity_type,entity_id,action,actor_id,reason,new_values)
      VALUES('stock_item',$1,$2,$3,$4,$5)`, [stockItemId,action,actorId,reason,values]);
  }
}
module.exports = StockItemMappingRepository;