class StockItemMappingRepository {
  constructor(client) { this.client = client; }
  async queue(filters, pagination) {
    const values = []; const where = [];
    const add = (value, expression) => { if (value != null && value !== '') { values.push(value); where.push(expression(values.length)); } };
    add(filters.status, n => `COALESCE(m.mapping_status, si.mapping_status, 'unmapped') = $${n}`);
    add(filters.stockItemId, n => `si.id = $${n}`);
    add(filters.genericItemId, n => `COALESCE(m.generic_item_id, si.generic_item_id) = $${n}`);
    add(filters.category, n => `si.category ILIKE '%' || $${n} || '%'`);
    add(filters.subcategory, n => `si.sub_category ILIKE '%' || $${n} || '%'`);
    add(filters.uom, n => `si.unit ILIKE '%' || $${n} || '%'`);
    add(filters.manufacturer, n => `si.brand ILIKE '%' || $${n} || '%'`);
    add(filters.identitySource, n => `si.identity_source = $${n}`);
    values.push(pagination.limit, pagination.offset);
    const query = `SELECT m.*, si.id AS stock_item_id, si.name AS stock_item_name,
        si.category, si.sub_category, si.unit, si.brand, si.available_quantity,
        si.identity_source, COALESCE(m.generic_item_id, si.generic_item_id) AS generic_item_id,
        COALESCE(m.approved_product_id, si.approved_product_id) AS approved_product_id,
        COALESCE(m.mapping_status, si.mapping_status, 'unmapped') AS mapping_status,
        jsonb_strip_nulls(jsonb_build_object('name',si.name,'category',si.category,
          'subcategory',si.sub_category,'uom',si.unit,'manufacturer',si.brand)) AS source_attributes,
        count(*) OVER()::int AS total_count
      FROM stock_items si
      LEFT JOIN LATERAL (
        SELECT sm.* FROM stock_item_master_mappings sm
        WHERE sm.stock_item_id=si.id
        ORDER BY sm.active DESC, sm.updated_at DESC, sm.id DESC LIMIT 1
      ) m ON true
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(m.updated_at, si.updated_at, si.created_at) DESC, si.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`;
    return (await this.client.query(query, values)).rows;
  }
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