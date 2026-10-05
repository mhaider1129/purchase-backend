const createHttpError = require('../utils/httpError');

const MODES = new Set(['free_text','generic_item','generic_item_with_preference','specific_approved_product','service','pending_item_creation','approved_free_text_exception']);
const STOCKING_POLICIES = new Set(['stock','non_stock','consignment','direct_delivery','service']);
const IDENTITY_FIELDS = Object.freeze([
  'generic_item_id', 'preferred_product_id', 'mandatory_product_id', 'request_mode',
  'catalog_status', 'stocking_policy', 'preferred_product_reason', 'restriction_justification',
  'required_date', 'item_name_snapshot', 'canonical_description_snapshot',
]);

// Missing mode on new, description-only demand is unresolved, never approved.
// Supplying catalog IDs without declaring their semantics is an input error.
const normalizeNewRequestItem = async (client, raw, user) => {
  const input = { ...raw };
  if (!String(input.item_name || '').trim()) throw createHttpError(400, 'Item name is required');
  input.item_name_snapshot = input.item_name_snapshot || String(input.item_name).trim();
  if (!Number.isInteger(Number(input.quantity)) || Number(input.quantity) <= 0) {
    throw createHttpError(400, 'Item quantity must be a positive whole number');
  }
  if (input.unit_cost != null && input.unit_cost !== '' && (!Number.isInteger(Number(input.unit_cost)) || Number(input.unit_cost)<0)) {
    throw createHttpError(400, 'Item unit cost must be a non-negative whole number');
  }
  if (!String(input.request_mode || '').trim()) {
    if (['generic_item_id','preferred_product_id','mandatory_product_id'].some(key => input[key] != null && input[key] !== '')) {
      throw createHttpError(400, 'request_mode is required when Item Master identities are supplied');
    }
    input.request_mode = 'free_text';
  }
  return validateRequestItemIdentity(client, input, user);
};

const isProcurementReady = item => {
  const mode = item?.request_mode;
  if (!MODES.has(mode)) return false;
  if (mode === 'service') return item.catalog_status === 'approved_exception';
  if (mode === 'approved_free_text_exception') return item.catalog_status === 'approved_exception'
    && Boolean(String(item.restriction_justification || '').trim());
  if (mode === 'free_text' || mode === 'pending_item_creation') return false;
  if (!item.generic_item_id || item.catalog_status !== 'catalogued') return false;
  if (mode === 'generic_item_with_preference') return Boolean(item.preferred_product_id) && !item.mandatory_product_id;
  if (mode === 'specific_approved_product') return Boolean(item.mandatory_product_id)
    && Boolean(String(item.restriction_justification || '').trim());
  return !item.mandatory_product_id && !item.preferred_product_id;
};

const assertProcurementReady = item => {
  if (!isProcurementReady(item)) throw Object.assign(createHttpError(409,
    'Resolve the requested item identity before active procurement'), {
    code: 'ITEM_IDENTITY_RESOLUTION_REQUIRED', unresolved_item_ids: [item?.id],
  });
};

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
  const physicalIds = genericItemId || preferredProductId || mandatoryProductId;
  if (['free_text','pending_item_creation','approved_free_text_exception'].includes(mode) && physicalIds) {
    throw createHttpError(400, 'Unmapped or exception lines cannot carry physical Item Master identities');
  }
  if (['generic_item','generic_item_with_preference'].includes(mode) && mandatoryProductId) {
    throw createHttpError(400, 'A product preference cannot become a mandatory restriction');
  }
  if (mode === 'generic_item' && preferredProductId) throw createHttpError(400, 'Use generic_item_with_preference for a preferred Product');

  if (mode === 'service') {
    if (genericItemId || preferredProductId || mandatoryProductId) throw createHttpError(400, 'Service lines cannot reference physical item master records');
    if (!String(raw.item_name || '').trim()) throw createHttpError(400, 'Service description is required');
    return { ...raw, request_mode: mode, stocking_policy: 'service', catalog_status: 'approved_exception', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
  }
  // A non-stock requisition is a statement of demand, not an item-master
  // transaction.  Its original wording remains authoritative until a human
  // resolves it after approval.
  if (mode === 'free_text') {
    if (stockingPolicy === 'stock') throw createHttpError(400, 'Free-text request lines cannot declare themselves stocked');
    if (!String(raw.item_name || '').trim()) throw createHttpError(400, 'Free-text item description is required');
    return { ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'pending_mapping', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null, item_name_snapshot: String(raw.item_name).trim() };
  }
  if (mode === 'approved_free_text_exception') {
    if (!user?.hasPermission?.('item-master.free-text-exception')) throw createHttpError(403, 'Free-text item exceptions require elevated permission');
    if (!justification) throw createHttpError(400, 'restriction_justification is required for a free-text exception');
    return { ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'approved_exception', generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
  }
  if (mode === 'pending_item_creation') {
    const pendingReason = String(raw.pending_item?.justification || raw.restriction_justification || '').trim();
    if (!pendingReason) throw createHttpError(400, 'Pending item justification is required');
    return { ...raw, request_mode: mode, stocking_policy: stockingPolicy, catalog_status: 'pending_mapping',
      restriction_justification: pendingReason, generic_item_id: null, preferred_product_id: null, mandatory_product_id: null };
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
    // Never replace the requester's description with a canonical label.
    item_name: raw.item_name || identity.generic_name, item_name_snapshot: raw.item_name_snapshot || raw.item_name || identity.generic_name,
    canonical_description_snapshot: identity.canonical_description,
    unit_of_measure: raw.unit_of_measure || identity.inventory_uom,
  };
};

// Resolution is an explicit identity change. Clear obsolete restrictions and
// use the same validator as request creation; retain the original description.
const resolveIdentity = async (client, line, target, actor) => validateRequestItemIdentity(client, {
  ...line, generic_item_id: null, preferred_product_id: null, mandatory_product_id: null,
  preferred_product_reason: null, restriction_justification: null,
  canonical_description_snapshot: null, ...target,
}, actor);

const writeResolvedIdentity = async (client, itemId, identity) => client.query(
  `UPDATE public.requested_items SET generic_item_id=$2,preferred_product_id=$3,mandatory_product_id=$4,
   request_mode=$5,catalog_status=$6,stocking_policy=$7,preferred_product_reason=$8,
   restriction_justification=$9,item_name_snapshot=COALESCE(item_name_snapshot,item_name),
   canonical_description_snapshot=$10 WHERE id=$1 RETURNING *`,
  [itemId,...['generic_item_id','preferred_product_id','mandatory_product_id','request_mode','catalog_status',
    'stocking_policy','preferred_product_reason','restriction_justification','canonical_description_snapshot']
    .map(key=>identity[key] ?? null)],
);

module.exports = { MODES, IDENTITY_FIELDS, normalizeNewRequestItem, validateRequestItemIdentity,
  resolveIdentity, writeResolvedIdentity, isProcurementReady, assertProcurementReady, auditItemMaster };
