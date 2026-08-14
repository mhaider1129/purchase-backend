const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const validator = require('../validators/itemMasterFoundationValidator');

const SORTS = Object.freeze({ name: 'generic_name', code: 'item_code', updated: 'updated_at', created: 'created_at' });
const pageOptions = query => ({
  page: Math.max(1, Number.parseInt(query.page, 10) || 1),
  pageSize: Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 25)),
  sort: SORTS[query.sort] || SORTS.name,
  direction: String(query.direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC',
});

class ItemMasterFoundationService {
  constructor(db = pool) { this.db = db; }

  async searchGeneric(query = {}) {
    const paging = pageOptions(query);
    const params = [];
    const where = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (query.q) add("CONCAT_WS(' ', item_code, generic_name, canonical_description, category, item_type) ILIKE ?", `%${String(query.q).trim()}%`);
    if (query.status) add('lifecycle_status = ?', query.status);
    if (query.category) add('category = ?', query.category);
    if (query.item_type) add('item_type = ?', query.item_type);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
    const result = await this.db.query(
      `SELECT *, COUNT(*) OVER()::INTEGER AS total_count FROM generic_items ${clause}
       ORDER BY ${paging.sort} ${paging.direction}, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: result.rows.map(({ total_count, ...row }) => row), page: paging.page, page_size: paging.pageSize, total: result.rows[0]?.total_count || 0 };
  }

  async createGeneric(payload, actorId) {
    const item = validator.genericItem(payload || {});
    if (!item.category_id || !item.base_uom_id || !item.inventory_uom_id) throw createHttpError(400, 'category_id, base_uom_id, and inventory_uom_id are required');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const references = await client.query(`SELECT
        EXISTS(SELECT 1 FROM item_categories WHERE id=$1 AND is_active=TRUE) category_ok,
        EXISTS(SELECT 1 FROM item_uom WHERE id=$2) base_uom_ok,
        EXISTS(SELECT 1 FROM item_uom WHERE id=$3) inventory_uom_ok`,[item.category_id,item.base_uom_id,item.inventory_uom_id]);
      if(!Object.values(references.rows[0]).every(Boolean)) throw createHttpError(400,'One or more controlled references are invalid or inactive');
      const duplicate = await client.query(
        `SELECT id, generic_name, structured_fingerprint FROM generic_items
         WHERE structured_fingerprint = $1
            OR (LOWER(category)=LOWER($2) AND LOWER(item_type)=LOWER($3)
                AND LOWER(base_uom)=LOWER($4) AND LOWER(generic_name)=LOWER($5))
         ORDER BY (structured_fingerprint = $1) DESC LIMIT 10`,
        [item.structured_fingerprint, item.category, item.item_type, item.base_uom, item.generic_name],
      );
      const created = await client.query(
        `INSERT INTO generic_items (item_code,generic_name,canonical_description,category,subcategory,item_type,specification,
          base_uom,inventory_uom,purchasing_uom,criticality,interchangeability_policy,batch_controlled,expiry_controlled,
          serial_controlled,is_sterile,is_proprietary,structured_fingerprint,category_id,base_uom_id,inventory_uom_id,purchasing_uom_id,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING *`,
        [item.item_code,item.generic_name,item.canonical_description,item.category,item.subcategory,item.item_type,item.specification,
          item.base_uom,item.inventory_uom,item.purchasing_uom,item.criticality,item.interchangeability_policy,item.batch_controlled,
          item.expiry_controlled,item.serial_controlled,item.is_sterile,item.is_proprietary,item.structured_fingerprint,item.category_id,
          item.base_uom_id,item.inventory_uom_id,item.purchasing_uom_id,actorId],
      );
      for (const candidate of duplicate.rows) {
        await client.query(
          `INSERT INTO item_duplicate_reviews (entity_type,source_id,candidate_id,score,matching_attributes)
           VALUES ('generic_item',$1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [created.rows[0].id, candidate.id, candidate.structured_fingerprint === item.structured_fingerprint ? 1 : 0.8,
            { generic_name: candidate.generic_name, structured_fingerprint: item.structured_fingerprint }],
        );
      }
      await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,new_values) VALUES ('generic_item',$1,'created',$2,$3)`,[created.rows[0].id,actorId,created.rows[0]]);
      await client.query('COMMIT');
      return { ...created.rows[0], duplicate_candidates: duplicate.rows };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw createHttpError(409, 'A generic item with this code already exists');
      throw error;
    } finally { client.release(); }
  }

  async transitionGeneric(id, nextStatus, actorId) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM generic_items WHERE id = $1 FOR UPDATE', [id]);
      if (!current.rowCount) throw createHttpError(404, 'Generic item not found');
      if (!validator.LIFECYCLE_TRANSITIONS[current.rows[0].lifecycle_status]?.includes(nextStatus)) {
        throw createHttpError(409, `Invalid lifecycle transition from ${current.rows[0].lifecycle_status} to ${nextStatus}`);
      }
      if (nextStatus === 'active') {
        const unresolved = await client.query("SELECT 1 FROM item_duplicate_reviews WHERE entity_type='generic_item' AND source_id=$1 AND decision='pending' LIMIT 1", [id]);
        if (unresolved.rowCount) throw createHttpError(409, 'Resolve duplicate candidates before activation');
      }
      const result = await client.query(
        `UPDATE generic_items SET lifecycle_status=$2,is_active=($2='active'),updated_by=$3,updated_at=NOW(),
          approved_by=CASE WHEN $2='active' THEN $3 ELSE approved_by END,
          approved_at=CASE WHEN $2='active' THEN NOW() ELSE approved_at END,
          retired_at=CASE WHEN $2='retired' THEN NOW() ELSE retired_at END WHERE id=$1 RETURNING *`,
        [id, nextStatus, actorId],
      );
      await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,previous_values,new_values) VALUES ('generic_item',$1,$2,$3,$4,$5)`,[id,`lifecycle.${nextStatus}`,actorId,current.rows[0],result.rows[0]]);
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async searchProducts(query = {}) {
    const { page, pageSize } = pageOptions(query); const params = []; const filters = [];
    if (query.q) { params.push(`%${query.q}%`); filters.push(`(p.product_name ILIKE $1 OR p.manufacturer ILIKE $1 OR p.manufacturer_part_number ILIKE $1 OR p.product_identifier ILIKE $1)`); }
    if (query.generic_item_id) { params.push(query.generic_item_id); filters.push(`p.generic_item_id=$${params.length}`); }
    params.push(pageSize, (page - 1) * pageSize);
    const result = await this.db.query(`SELECT p.*,g.item_code,g.generic_name,COUNT(*) OVER()::INTEGER total_count FROM approved_products p JOIN generic_items g ON g.id=p.generic_item_id ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY p.product_name LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    return { data: result.rows.map(({total_count,...row}) => row), page, page_size: pageSize, total: result.rows[0]?.total_count || 0 };
  }

  async createProduct(payload, actorId) {
    const p = validator.product(payload || {});
    if(!p.manufacturer_id||!p.product_uom_id)throw createHttpError(400,'manufacturer_id and product_uom_id are required');
    const active = await this.db.query("SELECT 1 FROM generic_items WHERE id=$1 AND lifecycle_status='active'", [p.generic_item_id]);
    if (!active.rowCount) throw createHttpError(409, 'Approved products require an active generic item');
    try {
      const manufacturer=await this.db.query('SELECT manufacturer_name FROM item_manufacturers WHERE id=$1 AND is_active=TRUE',[p.manufacturer_id]);
      const uom=await this.db.query('SELECT uom_code FROM item_uom WHERE id=$1',[p.product_uom_id]);
      if(!manufacturer.rowCount||!uom.rowCount)throw createHttpError(400,'Manufacturer or product UOM is invalid');
      const result = await this.db.query(`INSERT INTO approved_products (generic_item_id,product_identifier,manufacturer,manufacturer_id,product_name,product_description,manufacturer_part_number,normalized_manufacturer_part_number,model,technical_specifications,package_quantity,product_uom,product_uom_id,inventory_conversion_factor,regulatory_identifiers,technical_notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [p.generic_item_id,p.product_identifier,manufacturer.rows[0].manufacturer_name,p.manufacturer_id,p.product_name,p.product_description,p.manufacturer_part_number,p.normalized_manufacturer_part_number,p.model,p.technical_specifications,p.package_quantity,uom.rows[0].uom_code,p.product_uom_id,p.inventory_conversion_factor,p.regulatory_identifiers,p.technical_notes,actorId]);
      await this.db.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,new_values) VALUES ('approved_product',$1,'PRODUCT_CREATED',$2,$3)`,[result.rows[0].id,actorId,result.rows[0]]);
      return result.rows[0];
    } catch (error) { if (error.code === '23505') throw createHttpError(409, 'Manufacturer part number already exists'); throw error; }
  }

  async approveProduct(id, actorId) {
    return this.transitionProduct(id, 'approved', actorId);
  }

  async transitionProduct(id, status, actorId) {
    const actions={approved:'PRODUCT_APPROVED',rejected:'PRODUCT_REJECTED',retired:'PRODUCT_RETIRED'};
    if(!actions[status]) throw createHttpError(400,'Unsupported product lifecycle decision');
    const client=await this.db.connect();
    try { await client.query('BEGIN');
      const before=await client.query('SELECT * FROM approved_products WHERE id=$1 FOR UPDATE',[id]);
      if(!before.rowCount) throw createHttpError(404,'Product not found');
      const allowed=status==='retired'?['approved']:['draft','pending'];
      if(!allowed.includes(before.rows[0].approval_status)) throw createHttpError(409,'Product is not eligible for this decision');
      const result=await client.query(`UPDATE approved_products SET approval_status=$2,is_active=($2='approved'),approved_by=CASE WHEN $2='approved' THEN $3 ELSE approved_by END,approved_at=CASE WHEN $2='approved' THEN NOW() ELSE approved_at END,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,status,actorId]);
      await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,previous_values,new_values) VALUES ('approved_product',$1,$2,$3,$4,$5)`,[id,actions[status],actorId,before.rows[0],result.rows[0]]);
      await client.query('COMMIT'); return result.rows[0];
    } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }

  async searchCatalog(query = {}) {
    const { page, pageSize } = pageOptions(query); const params=[]; const filters=[];
    if (query.q) { params.push(`%${query.q}%`); filters.push(`(c.supplier_item_code ILIKE $1 OR c.supplier_description ILIKE $1 OR s.name ILIKE $1 OR p.product_name ILIKE $1)`); }
    if (query.supplier_id) { params.push(query.supplier_id); filters.push(`c.supplier_id=$${params.length}`); }
    params.push(pageSize,(page-1)*pageSize);
    const result=await this.db.query(`SELECT c.*,s.name supplier_name,p.product_name,p.manufacturer,g.item_code,g.generic_name,COUNT(*) OVER()::INTEGER total_count FROM supplier_catalog_items c JOIN suppliers s ON s.id=c.supplier_id JOIN approved_products p ON p.id=c.approved_product_id JOIN generic_items g ON g.id=p.generic_item_id ${filters.length?`WHERE ${filters.join(' AND ')}`:''} ORDER BY c.updated_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    return {data:result.rows.map(({total_count,...row})=>row),page,page_size:pageSize,total:result.rows[0]?.total_count||0};
  }

  async createCatalog(payload, actorId) {
    const c=validator.catalog(payload||{});
    if (c.currency && !/^[A-Z]{3}$/.test(c.currency)) throw createHttpError(400,'currency must be an ISO 4217 code');
    const product=await this.db.query("SELECT 1 FROM approved_products WHERE id=$1 AND approval_status='approved' AND is_active",[c.approved_product_id]);
    if(!product.rowCount) throw createHttpError(409,'Supplier catalog requires an active approved product');
    try { const result=await this.db.query(`INSERT INTO supplier_catalog_items (supplier_id,approved_product_id,supplier_item_code,supplier_description,purchasing_uom,conversion_factor,package_size,minimum_order_quantity,order_multiple,unit_price,currency,lead_time_days,is_preferred_supplier,is_approved_supplier,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,Object.values(c).concat(actorId)); await this.auditCatalog('CATALOG_CREATED',result.rows[0].id,actorId,null,result.rows[0]); return result.rows[0]; }
    catch(error){if(error.code==='23505')throw createHttpError(409,'Supplier item code already exists for this supplier');throw error;}
  }

  async updateCatalog(id, payload, actorId) {
    const current = await this.db.query('SELECT * FROM supplier_catalog_items WHERE id=$1', [id]);
    if (!current.rowCount) throw createHttpError(404, 'Supplier catalog item not found');
    const merged = validator.catalog({ ...current.rows[0], ...(payload || {}) });
    const result = await this.db.query(`UPDATE supplier_catalog_items SET supplier_id=$2,approved_product_id=$3,supplier_item_code=$4,supplier_description=$5,purchasing_uom=$6,conversion_factor=$7,package_size=$8,minimum_order_quantity=$9,order_multiple=$10,unit_price=$11,currency=$12,lead_time_days=$13,is_preferred_supplier=$14,is_approved_supplier=$15,updated_by=$16,updated_at=NOW() WHERE id=$1 RETURNING *`, [id, ...Object.values(merged), actorId]);
    await this.auditCatalog('CATALOG_UPDATED',id,actorId,current.rows[0],result.rows[0]); return result.rows[0];
  }

  async deactivateCatalog(id, actorId) {
    const result = await this.db.query('UPDATE supplier_catalog_items SET is_active=FALSE,updated_by=$2,updated_at=NOW() WHERE id=$1 AND is_active RETURNING *', [id, actorId]);
    if (!result.rowCount) throw createHttpError(404, 'Active supplier catalog item not found');
    await this.auditCatalog('CATALOG_DEACTIVATED',id,actorId,null,result.rows[0]); return result.rows[0];
  }

  async auditCatalog(action,id,actorId,before,after){
    await this.db.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,previous_values,new_values) VALUES ('supplier_catalog_item',$1,$2,$3,$4,$5)`,[id,action,actorId,before,after]);
  }

  async searchReferences(type, query={}) {
    const definitions={categories:['item_categories','category_name','normalized_name'],manufacturers:['item_manufacturers','manufacturer_name','normalized_name'],uom:['item_uom','uom_code','normalized_uom_code']};
    const definition=definitions[type]; if(!definition) throw createHttpError(400,'Invalid reference type');
    const [table,name]=definition; const q=String(query.q||'').trim();
    const result=await this.db.query(`SELECT * FROM ${table} WHERE ($1='' OR ${name} ILIKE $2) ORDER BY ${name} LIMIT 100`,[q,`%${q}%`]); return result.rows;
  }

  async createReference(type,payload,actorId){
    const definitions={categories:['item_categories','category_name','normalized_name','lower'],manufacturers:['item_manufacturers','manufacturer_name','normalized_name','lower'],uom:['item_uom','uom_code','normalized_uom_code','upper']};
    const d=definitions[type]; if(!d)throw createHttpError(400,'Invalid reference type');
    const raw=String(payload.name||payload.code||'').trim(); if(!raw)throw createHttpError(400,'Reference name/code is required');
    const normalized=d[3]==='upper'?raw.toUpperCase().replace(/[^A-Z0-9]/g,''):raw.toLowerCase().replace(/\s+/g,' ');
    try { const result=await this.db.query(`INSERT INTO ${d[0]} (${d[1]},${d[2]},is_active,created_by) VALUES ($1,$2,TRUE,$3) RETURNING *`,[raw,normalized,actorId]); await this.db.query(`INSERT INTO item_master_audit_events(entity_type,entity_id,action,actor_id,new_values) VALUES ($1,$2,'REFERENCE_CREATED',$3,$4)`,[d[0],result.rows[0].id,actorId,result.rows[0]]); return result.rows[0]; } catch(error){if(error.code==='23505')throw createHttpError(409,'Normalized reference already exists');throw error;}
  }

  async deactivateReference(type,id,actorId){
    const tables={categories:'item_categories',manufacturers:'item_manufacturers',uom:'item_uom'}; const table=tables[type]; if(!table)throw createHttpError(400,'Invalid reference type');
    const result=await this.db.query(`UPDATE ${table} SET is_active=FALSE,updated_by=$2 WHERE id=$1 AND is_active RETURNING *`,[id,actorId]); if(!result.rowCount)throw createHttpError(404,'Active reference not found'); await this.db.query(`INSERT INTO item_master_audit_events(entity_type,entity_id,action,actor_id,new_values) VALUES ($1,$2,'REFERENCE_DEACTIVATED',$3,$4)`,[table,id,actorId,result.rows[0]]); return result.rows[0];
  }

  async submitPending(payload, actorId) {
    const p=validator.pending(payload||{}); const result=await this.db.query(`INSERT INTO pending_item_requests (proposed_name,item_type,category,required_specifications,intended_use,requested_quantity,requested_uom,justification,request_id,requested_item_id,requester_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,Object.values(p).concat(actorId)); return result.rows[0];
  }

  async pendingQueue(query={}) { const {page,pageSize}=pageOptions(query); const params=[]; let clause=''; if(query.status){params.push(query.status);clause='WHERE status=$1';} params.push(pageSize,(page-1)*pageSize); const result=await this.db.query(`SELECT *,COUNT(*) OVER()::INTEGER total_count FROM pending_item_requests ${clause} ORDER BY created_at ASC LIMIT $${params.length-1} OFFSET $${params.length}`,params); return {data:result.rows.map(({total_count,...row})=>row),page,page_size:pageSize,total:result.rows[0]?.total_count||0}; }

  async referenceData() {
    const [categories,uom,manufacturers] = await Promise.all([
      this.db.query('SELECT id,category_name name,description FROM item_categories WHERE is_active=TRUE ORDER BY category_name'),
      this.db.query('SELECT id,uom_code code,uom_name name,description FROM item_uom ORDER BY uom_code'),
      this.db.query('SELECT id,manufacturer_name name,country_of_origin FROM item_manufacturers WHERE is_active=TRUE ORDER BY manufacturer_name'),
    ]);
    return {categories:categories.rows,uom:uom.rows,manufacturers:manufacturers.rows};
  }

  async legacyCoverage() {
    const result = await this.db.query(`SELECT source_table,total,mapped,total-mapped unmapped,
      CASE WHEN total=0 THEN 100 ELSE ROUND(mapped*100.0/total,2) END coverage_percent FROM (
      SELECT 'item_master_items' source_table,(SELECT COUNT(*) FROM item_master_items)::INTEGER total,
        (SELECT COUNT(*) FROM legacy_item_mappings WHERE source_table='item_master_items' AND mapping_status='active')::INTEGER mapped
      UNION ALL SELECT 'item_master',(SELECT COUNT(*) FROM item_master)::INTEGER,
        (SELECT COUNT(*) FROM legacy_item_mappings WHERE source_table='item_master' AND mapping_status='active')::INTEGER) coverage`);
    return result.rows;
  }

  async unmappedLegacy(query={}) {
    const source = query.source_table === 'item_master' ? 'item_master' : 'item_master_items';
    const result = await this.db.query(`SELECT l.id,l.item_code,l.item_name,l.generic_name FROM ${source} l LEFT JOIN legacy_item_mappings m ON m.source_table=$1 AND m.legacy_item_id=l.id AND m.mapping_status='active' WHERE m.id IS NULL ORDER BY l.id LIMIT 100`,[source]);
    return result.rows;
  }

  async mapLegacy(payload, actorId) {
    const source = payload.source_table === 'item_master' ? 'item_master' : payload.source_table === 'item_master_items' ? 'item_master_items' : null;
    if(!source) throw createHttpError(400,'source_table is invalid');
    const client=await this.db.connect();
    try { await client.query('BEGIN'); const generic=await client.query("SELECT id FROM generic_items WHERE id=$1 AND lifecycle_status <> 'retired' FOR UPDATE",[payload.generic_item_id]); if(!generic.rowCount)throw createHttpError(400,'Target Generic Item is invalid'); const legacy=await client.query(`SELECT id,item_code,item_name FROM ${source} WHERE id=$1 FOR UPDATE`,[payload.legacy_item_id]); if(!legacy.rowCount)throw createHttpError(404,'Legacy item not found'); const row=legacy.rows[0]; const mapped=await client.query(`INSERT INTO legacy_item_mappings (source_table,legacy_item_id,generic_item_id,legacy_code_snapshot,legacy_name_snapshot,mapping_reason,mapped_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[source,row.id,payload.generic_item_id,row.item_code,row.item_name,String(payload.reason||'').trim(),actorId]); await client.query(`INSERT INTO item_master_aliases (generic_item_id,alias_type,alias_value,normalized_alias,source_table,source_id,created_by) VALUES ($1,'legacy_name',$2,LOWER(TRIM($2)),$3,$4,$5) ON CONFLICT DO NOTHING`,[payload.generic_item_id,row.item_name,source,row.id,actorId]); await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,reason,source_id,target_id,new_values) VALUES ('legacy_mapping',$1,'created',$2,$3,$4,$5,$6)`,[mapped.rows[0].id,actorId,payload.reason,row.id,payload.generic_item_id,mapped.rows[0]]); await client.query('COMMIT'); return mapped.rows[0]; } catch(error){await client.query('ROLLBACK');if(error.code==='23505')throw createHttpError(409,'Legacy item already has an active mapping');throw error;} finally{client.release();}
  }

  async requestMerge(payload, actorId) {
    const source=Number(payload.source_generic_item_id),target=Number(payload.target_generic_item_id),reason=String(payload.reason||'').trim();
    if(!source||!target||source===target)throw createHttpError(400,'Distinct source and target Generic Items are required'); if(!reason)throw createHttpError(400,'Merge reason is required');
    const client=await this.db.connect(); try{await client.query('BEGIN');const locked=await client.query('SELECT id,lifecycle_status FROM generic_items WHERE id=ANY($1::BIGINT[]) ORDER BY id FOR UPDATE',[[source,target]]);if(locked.rowCount!==2)throw createHttpError(404,'Source or target Generic Item not found');const conflicts=await client.query(`SELECT s.id source_product,t.id target_product,s.manufacturer_id,s.normalized_manufacturer_part_number FROM approved_products s JOIN approved_products t ON t.generic_item_id=$2 AND t.manufacturer_id=s.manufacturer_id AND t.normalized_manufacturer_part_number=s.normalized_manufacturer_part_number WHERE s.generic_item_id=$1`,[source,target]);const result=await client.query(`INSERT INTO generic_item_merges (source_generic_item_id,target_generic_item_id,merge_reason,conflict_details,reviewed_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[source,target,reason,{product_conflicts:conflicts.rows},actorId]);await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,reason,source_id,target_id,new_values) VALUES ('generic_item_merge',$1,'merge_pending',$2,$3,$4,$5,$6)`,[result.rows[0].id,actorId,reason,source,target,result.rows[0]]);await client.query('COMMIT');return result.rows[0];}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async resolvePending(id, payload, actor) {
    const resolutionType = String(payload.resolution_type || '');
    const allowed = ['existing_generic','existing_product','supplier_catalog_only','new_generic_draft','approved_free_text_exception','rejected','needs_information'];
    if (!allowed.includes(resolutionType)) throw createHttpError(400, 'resolution_type is invalid');
    const actorId = actor?.id || actor;
    const notes = String(payload.notes || '').trim();
    if (['rejected','approved_free_text_exception'].includes(resolutionType) && !notes) throw createHttpError(400, 'Resolution notes are required');
    if (resolutionType === 'approved_free_text_exception' && !actor?.hasPermission?.('item-master.free-text-exception')) throw createHttpError(403, 'Free-text exception permission is required');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const pendingResult = await client.query(
        `SELECT p.*,r.institute_id,r.department_id FROM pending_item_requests p
         LEFT JOIN requests r ON r.id=p.request_id WHERE p.id=$1 FOR UPDATE OF p`, [id]);
      if (!pendingResult.rowCount) throw createHttpError(404, 'Pending item request not found');
      const pending = pendingResult.rows[0];
      if (!['submitted','review','needs_information'].includes(pending.status)) throw createHttpError(409, 'Pending item has already been resolved');
      if (actor?.institute_id && pending.institute_id && Number(actor.institute_id) !== Number(pending.institute_id)) throw createHttpError(403, 'Pending item belongs to another institute');
      if (pending.requested_item_id) {
        const line = await client.query('SELECT id,request_id,item_name FROM requested_items WHERE id=$1 AND request_id=$2 FOR UPDATE', [pending.requested_item_id,pending.request_id]);
        if (!line.rowCount) throw createHttpError(409, 'Related request line no longer exists');
      }
      let genericItemId = payload.generic_item_id ? Number(payload.generic_item_id) : null;
      let productId = payload.product_id ? Number(payload.product_id) : null;
      if (['existing_generic','existing_product','supplier_catalog_only'].includes(resolutionType)) {
        const generic = await client.query("SELECT id FROM generic_items WHERE id=$1 AND lifecycle_status='active' AND is_active=TRUE", [genericItemId]);
        if (!generic.rowCount) throw createHttpError(400, 'Resolution requires an active Generic Item');
      }
      if (['existing_product','supplier_catalog_only'].includes(resolutionType)) {
        const product = await client.query("SELECT id FROM approved_products WHERE id=$1 AND generic_item_id=$2 AND approval_status='approved' AND is_active=TRUE", [productId,genericItemId]);
        if (!product.rowCount) throw createHttpError(400, 'Resolution product is not active, approved, or owned by the Generic Item');
      }
      if (resolutionType === 'supplier_catalog_only') {
        const catalog = await client.query('SELECT id FROM supplier_catalog_items WHERE id=$1 AND approved_product_id=$2 AND is_active=TRUE', [payload.supplier_catalog_item_id,productId]);
        if (!catalog.rowCount) throw createHttpError(400, 'Supplier Catalog Item is inactive or does not belong to the product');
      }
      if (resolutionType === 'new_generic_draft') {
        const draft = validator.genericItem(payload.generic_item || {});
        const created = await client.query(`INSERT INTO generic_items
          (item_code,generic_name,canonical_description,category,subcategory,item_type,specification,base_uom,inventory_uom,
           purchasing_uom,criticality,interchangeability_policy,batch_controlled,expiry_controlled,serial_controlled,is_sterile,
           is_proprietary,structured_fingerprint,category_id,base_uom_id,inventory_uom_id,purchasing_uom_id,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING id`,
          [draft.item_code,draft.generic_name,draft.canonical_description,draft.category,draft.subcategory,draft.item_type,draft.specification,
            draft.base_uom,draft.inventory_uom,draft.purchasing_uom,draft.criticality,draft.interchangeability_policy,draft.batch_controlled,
            draft.expiry_controlled,draft.serial_controlled,draft.is_sterile,draft.is_proprietary,draft.structured_fingerprint,draft.category_id,
            draft.base_uom_id,draft.inventory_uom_id,draft.purchasing_uom_id,actorId]);
        genericItemId = created.rows[0].id;
      }
      if (pending.requested_item_id) {
        if (resolutionType === 'existing_generic') await client.query("UPDATE requested_items SET generic_item_id=$2,request_mode='generic_item',catalog_status='catalogued',item_name_snapshot=COALESCE(item_name_snapshot,item_name) WHERE id=$1", [pending.requested_item_id,genericItemId]);
        if (resolutionType === 'existing_product') await client.query("UPDATE requested_items SET generic_item_id=$2,preferred_product_id=$3,request_mode='generic_item_with_preference',catalog_status='catalogued',item_name_snapshot=COALESCE(item_name_snapshot,item_name) WHERE id=$1", [pending.requested_item_id,genericItemId,productId]);
        if (resolutionType === 'rejected') await client.query("UPDATE requested_items SET catalog_status='pending_mapping',procurement_status='rejected' WHERE id=$1", [pending.requested_item_id]);
        if (resolutionType === 'approved_free_text_exception') await client.query("UPDATE requested_items SET request_mode='approved_free_text_exception',catalog_status='approved_exception',restriction_justification=$2 WHERE id=$1", [pending.requested_item_id,notes]);
      }
      const status = resolutionType === 'needs_information' ? 'needs_information' : resolutionType === 'rejected' ? 'rejected' : resolutionType === 'approved_free_text_exception' ? 'approved_exception' : resolutionType === 'new_generic_draft' ? 'review' : 'resolved';
      const result = await client.query(`UPDATE pending_item_requests SET status=$2,resolution_type=$3,resolved_generic_item_id=$4,resolved_product_id=$5,resolution_notes=$6,resolved_by=CASE WHEN $2='needs_information' THEN NULL ELSE $7 END,resolved_at=CASE WHEN $2='needs_information' THEN NULL ELSE NOW() END,updated_at=NOW() WHERE id=$1 RETURNING *`, [id,status,resolutionType,genericItemId,productId,notes||null,actorId]);
      await client.query(`INSERT INTO item_master_audit_events (entity_type,entity_id,action,actor_id,reason,request_id,requested_item_id,new_values,organizational_context) VALUES ('pending_item_request',$1,$2,$3,$4,$5,$6,$7,$8)`, [id,`resolved.${resolutionType}`,actorId,notes||null,pending.request_id,pending.requested_item_id,result.rows[0],{institute_id:pending.institute_id,department_id:pending.department_id}]);
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async resolveDuplicate(id,payload,actorId){ const decision=String(payload.decision||''); if(!['duplicate','not_duplicate'].includes(decision))throw createHttpError(400,'decision is invalid; use the governed merge operation for duplicates'); const result=await this.db.query("UPDATE item_duplicate_reviews SET decision=$2,review_notes=$3,reviewed_by=$4,reviewed_at=NOW() WHERE id=$1 AND decision='pending' RETURNING *",[id,decision,String(payload.notes||'').trim()||null,actorId]); if(!result.rowCount)throw createHttpError(409,'Duplicate review is already resolved or missing'); return result.rows[0]; }
}

module.exports = { ItemMasterFoundationService, pageOptions };