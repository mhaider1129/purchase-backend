'use strict';
const createHttpError = require('../utils/httpError');
const { auditItemMaster } = require('./procurementItemIdentityService');

const notFound=()=>Object.assign(createHttpError(404,'Requested item not found in request'),{code:'REQUEST_ITEM_NOT_FOUND_IN_REQUEST'});
const resolveRequestItem = async (client, requestId, itemId, input, actor) => {
  const reason = String(input.reason || '').trim();
  if (!reason) throw createHttpError(400, 'resolution reason is required');
  const current = await client.query(`SELECT ri.*,r.status request_status FROM requested_items ri JOIN requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ri.request_id=$2 FOR UPDATE OF ri`, [itemId,requestId]);
  if (!current.rowCount) throw notFound();
  const line = current.rows[0];
  if (!['approved','completed','assigned'].includes(String(line.request_status).toLowerCase())) throw createHttpError(409, 'Request approval must complete before item identity resolution');

  let genericId = input.generic_item_id ? Number(input.generic_item_id) : null;
  let productId = input.approved_product_id ? Number(input.approved_product_id) : null;
  let stockItemId = input.stock_item_id ? Number(input.stock_item_id) : null;
  if (stockItemId) {
    const stock = await client.query('SELECT id,generic_item_id,approved_product_id,name FROM stock_items WHERE id=$1', [stockItemId]);
    if (!stock.rowCount || !stock.rows[0].generic_item_id) throw createHttpError(400, 'Stock Item is not explicitly mapped to a Generic Item');
    genericId = Number(stock.rows[0].generic_item_id);
    productId = productId || stock.rows[0].approved_product_id;
  }
  if (!genericId) throw createHttpError(400, 'generic_item_id or stock_item_id is required');
  const generic = await client.query("SELECT id FROM generic_items WHERE id=$1 AND lifecycle_status='active' AND is_active=TRUE", [genericId]);
  if (!generic.rowCount) throw createHttpError(400, 'Target Generic Item is not active');
  if (productId) {
    const product = await client.query("SELECT id FROM approved_products WHERE id=$1 AND generic_item_id=$2 AND approval_status='approved' AND is_active=TRUE", [productId, genericId]);
    if (!product.rowCount) throw createHttpError(400, 'Target Product is not approved for the Generic Item');
  }
  const updated = await client.query(`UPDATE requested_items SET generic_item_id=$2,preferred_product_id=$3,request_mode=$4,catalog_status='catalogued',item_name_snapshot=COALESCE(item_name_snapshot,item_name) WHERE id=$1 RETURNING *`, [itemId,genericId,productId,productId?'generic_item_with_preference':'generic_item']);
  await auditItemMaster(client, { entityType:'requested_item', entityId:itemId, action:stockItemId?'resolved.stock_item':productId?'resolved.product':'resolved.generic', actorId:actor.id, reason, previous:line, next:updated.rows[0], requestId:line.request_id, requestedItemId:itemId, sourceId:stockItemId, targetId:productId||genericId, context:{ stock_item_id:stockItemId, resolved_generic_item_id:genericId, resolved_product_id:productId, resolved_at:new Date().toISOString() } });
  return { ...updated.rows[0], resolution: { state:productId?'RESOLVED_PRODUCT':'RESOLVED_GENERIC', resolved_generic_item_id:genericId, resolved_product_id:productId, stock_item_id:stockItemId, resolved_by:actor.id, reason } };
};

const linkPendingItemRequest = async (client, requestId, itemId, input, actor) => {
  const reason=String(input.justification||'').trim();
  if(!reason) throw createHttpError(400,'pending item justification is required');
  const found=await client.query(`SELECT ri.*,r.status request_status FROM requested_items ri JOIN requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ri.request_id=$2 FOR UPDATE OF ri`,[itemId,requestId]);
  if(!found.rowCount) throw notFound();
  const line=found.rows[0];
  if(!['approved','completed','assigned'].includes(String(line.request_status).toLowerCase())) throw createHttpError(409,'Request approval must complete before master-data referral');
  const existing=await client.query("SELECT * FROM pending_item_requests WHERE requested_item_id=$1 AND status IN ('submitted','review','needs_information') ORDER BY id FOR UPDATE",[itemId]);
  if(existing.rowCount)return existing.rows[0];
  const terminal=await client.query('SELECT id FROM pending_item_requests WHERE requested_item_id=$1 ORDER BY id DESC LIMIT 1',[itemId]);
  if(terminal.rowCount&&input.allow_new_after_terminal!==true)throw Object.assign(createHttpError(409,'A terminal referral exists; explicit governed re-referral authorization is required'),{code:'PENDING_ITEM_REREFERRAL_AUTHORIZATION_REQUIRED'});
  const pending=await client.query(`INSERT INTO pending_item_requests (request_id,requested_item_id,proposed_name,item_type,category,required_specifications,intended_use,requested_quantity,requested_uom,justification,requester_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[line.request_id,itemId,String(input.proposed_name||line.item_name).trim(),String(input.item_type||'general_item').trim(),input.category||null,input.required_specifications||{},line.intended_use||'',line.quantity,line.unit_of_measure||null,reason,actor.id]);
  await client.query("UPDATE requested_items SET request_mode='pending_item_creation',catalog_status='pending_mapping',item_name_snapshot=COALESCE(item_name_snapshot,item_name) WHERE id=$1",[itemId]);
  await auditItemMaster(client,{entityType:'pending_item_request',entityId:pending.rows[0].id,action:'linked.after_approval',actorId:actor.id,reason,requestId:line.request_id,requestedItemId:itemId,next:pending.rows[0],context:{pending_item_request_id:pending.rows[0].id}});
  return pending.rows[0];
};

module.exports = { resolveRequestItem, linkPendingItemRequest };