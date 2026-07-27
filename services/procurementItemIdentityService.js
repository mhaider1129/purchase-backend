const createHttpError = require('../utils/httpError');

const MODES = new Set(['generic_item','generic_item_with_preference','specific_approved_product','service','pending_item_creation','approved_free_text_exception']);
const STOCKING_POLICIES = new Set(['stock','non_stock','consignment','direct_delivery','service']);

const positiveId = (value, field) => {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, `${field} must be a valid ID`);
  return id;
};

const auditItemMaster = async (client, event) => client.query(
  `INSERT INTO item_master_audit_events
   (entity_type,entity_id,action,actor_id,reason,previous_values,new_values,request_id,requested_item_id,source_id,target_id,organizational_context)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [event.entityType,event.entityId||null,event.action,event.actorId||null,event.reason||null,event.previous||null,event.next||null,
    event.requestId||null,event.requestedItemId||null,event.sourceId||null,event.targetId||null,event.context||{}],
);

const validateRequestItemIdentity = async (client, raw, user, { requireGovernedIdentity = true } = {}) => {
  const mode = String(raw.request_mode || '').trim().toLowerCase();
  if (!MODES.has(mode)) throw createHttpError(400, 'Each procurement line requires a valid request_mode');
  const stockingPolicy = String(raw.stocking_policy || (mode === 'service' ? 'service' : 'non_stock')).trim().toLowerCase();
  if (!STOCKING_POLICIES.has(stockingPolicy)) throw createHttpError(400, 'stocking_policy is invalid');
  const genericItemId = positiveId(raw.generic_item_id, 'generic_item_id');
  const preferredProductId = positiveId(raw.preferred_product_id, 'preferred_product_id');
  const mandatoryProductId = positiveId(raw.mandatory_product_id, 'mandatory_product_id');
  const justification = String(raw.restriction_justification || '').trim();

  if (mode === 'service') {
    if (genericItemId || preferredProductId || mandatoryProductId) throw createHttpError(400, 'Service lines cannot reference physical item master records');
    if (!String(raw.item_name || '').trim()) throw createHttpError(400, 'Service description is required');
    return { ...raw, request_mode: mode, stocking_policy: 'service', catalog_status: 'approved_exception', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
  }
  if (mode === 'approved_free_text_exception') {
    if (!user?.hasPermission?.('item-master.free-text-exception')) throw createHttpError(403, 'Free-text item exceptions require elevated permission');
    if (!justification) throw createHttpError(400, 'restriction_justification is required for a free-text exception');
    return { ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'approved_exception', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
  }
  if (mode === 'pending_item_creation') {
    if (!String(raw.pending_item?.justification || raw.restriction_justification || '').trim()) throw createHttpError(400, 'Pending item justification is required');
    return { ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'pending_mapping', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
  }
  if (requireGovernedIdentity && !genericItemId) throw createHttpError(400, 'Physical procurement lines require an active generic_item_id');

  const generic = await client.query(
    `SELECT g.id,g.item_code,g.generic_name,g.canonical_description,g.inventory_uom,g.interchangeability_policy
       FROM generic_items g WHERE g.id=$1 AND g.lifecycle_status='active' AND g.is_active=TRUE`, [genericItemId]);
  if (!generic.rowCount) throw createHttpError(400, 'Selected Generic Item is missing, inactive, or not approved');
  const checkProduct = async (productId, label) => {
    if (!productId) return null;
    const product = await client.query(`SELECT id,generic_item_id,product_name FROM approved_products WHERE id=$1 AND generic_item_id=$2 AND approval_status='approved' AND is_active=TRUE`, [productId,genericItemId]);
    if (!product.rowCount) throw createHttpError(400, `${label} must be active, approved, and belong to the selected Generic Item`);
    return product.rows[0];
  };
  if (mode === 'generic_item_with_preference' && !preferredProductId) throw createHttpError(400, 'preferred_product_id is required for a preferred-product request');
  if (mode === 'specific_approved_product' && !mandatoryProductId) throw createHttpError(400, 'mandatory_product_id is required for a restricted product request');
  if (mode === 'specific_approved_product' && !justification) throw createHttpError(400, 'restriction_justification is required for a mandatory product');
  await checkProduct(preferredProductId, 'Preferred Product');
  await checkProduct(mandatoryProductId, 'Mandatory Product');
  const identity = generic.rows[0];
  return {
    ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'catalogued',
    generic_item_id: genericItemId, preferred_product_id: preferredProductId, mandatory_product_id: mandatoryProductId,
    item_name: identity.generic_name, item_name_snapshot: identity.generic_name,
    canonical_description_snapshot: identity.canonical_description,
    unit_of_measure: raw.unit_of_measure || identity.inventory_uom,
  };
};

module.exports = { MODES, validateRequestItemIdentity, auditItemMaster };