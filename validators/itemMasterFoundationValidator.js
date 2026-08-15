const createHttpError = require('../utils/httpError');
const { canonicalFingerprint } = require('../utils/itemFingerprint');

const LIFECYCLE_TRANSITIONS = Object.freeze({
  draft: ['review'],
  review: ['validation', 'draft'],
  validation: ['approval', 'review'],
  approval: ['active', 'validation'],
  active: ['retired'],
  retired: [],
});

const INTERCHANGEABILITY = new Set([
  'fully_interchangeable', 'conditionally_interchangeable', 'non_interchangeable',
  'proprietary', 'approval_required',
]);

const text = (value, field, required = false) => {
  const normalized = value == null ? '' : String(value).trim();
  if (required && !normalized) throw createHttpError(400, `${field} is required`);
  return normalized || null;
};

const positive = (value, field, fallback = null) => {
  if (value == null || value === '') return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw createHttpError(400, `${field} must be greater than zero`);
  }
  return normalized;
};

// PostgreSQL NUMERIC values cross this boundary as canonical decimal strings.
// Never convert authoritative quantities or money through IEEE-754 Number.
const decimal = (value, field, { fallback = null, allowZero = false } = {}) => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim();
  if (!/^\+?(?:\d+)(?:\.\d+)?$/.test(normalized)) {
    throw createHttpError(400, `${field} must be an exact decimal`);
  }
  const canonical = normalized.replace(/^\+/, '').replace(/^0+(?=\d)/, '');
  if (!allowZero && /^0(?:\.0+)?$/.test(canonical)) throw createHttpError(400, `${field} must be greater than zero`);
  return canonical;
};

const object = (value, field, fallback = {}) => {
  if (value == null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, `${field} must be an object`);
  }
  return value;
};

const fingerprint = item => canonicalFingerprint({
  generic_name: item.generic_name,
  category_id: item.category_id || item.category,
  subcategory_id: item.subcategory_id || item.subcategory,
  item_type_id: item.item_type_id || item.item_type,
  base_uom_id: item.base_uom_id || item.base_uom,
  inventory_uom_id: item.inventory_uom_id || item.inventory_uom,
  is_sterile: item.is_sterile,
  specification: item.specification,
}).hash;

const genericItem = payload => {
  const value = {
    item_code: text(payload.item_code, 'item_code', true).toUpperCase(),
    generic_name: text(payload.generic_name, 'generic_name', true),
    canonical_description: text(payload.canonical_description, 'canonical_description', true),
    category: text(payload.category, 'category', true),
    subcategory: text(payload.subcategory, 'subcategory'),
    item_type: text(payload.item_type, 'item_type', true),
    specification: object(payload.specification, 'specification'),
    base_uom: text(payload.base_uom, 'base_uom', true).toUpperCase(),
    inventory_uom: text(payload.inventory_uom, 'inventory_uom', true).toUpperCase(),
    purchasing_uom: text(payload.purchasing_uom, 'purchasing_uom')?.toUpperCase() || null,
    criticality: text(payload.criticality, 'criticality') || 'routine',
    interchangeability_policy: text(payload.interchangeability_policy, 'interchangeability_policy') || 'approval_required',
    batch_controlled: Boolean(payload.batch_controlled),
    expiry_controlled: Boolean(payload.expiry_controlled),
    serial_controlled: Boolean(payload.serial_controlled),
    is_sterile: Boolean(payload.is_sterile),
    is_proprietary: Boolean(payload.is_proprietary),
    category_id: positive(payload.category_id, 'category_id'),
    base_uom_id: positive(payload.base_uom_id, 'base_uom_id'),
    inventory_uom_id: positive(payload.inventory_uom_id, 'inventory_uom_id'),
    purchasing_uom_id: positive(payload.purchasing_uom_id, 'purchasing_uom_id'),
  };
  if (!INTERCHANGEABILITY.has(value.interchangeability_policy)) {
    throw createHttpError(400, 'interchangeability_policy is invalid');
  }
  if (value.is_proprietary) value.interchangeability_policy = 'proprietary';
  value.structured_fingerprint = fingerprint(value);
  return value;
};

const product = payload => ({
  generic_item_id: positive(payload.generic_item_id, 'generic_item_id'),
  product_identifier: text(payload.product_identifier, 'product_identifier'),
  manufacturer: text(payload.manufacturer, 'manufacturer', true),
  manufacturer_id: positive(payload.manufacturer_id, 'manufacturer_id'),
  product_name: text(payload.product_name, 'product_name', true),
  product_description: text(payload.product_description, 'product_description'),
  manufacturer_part_number: text(payload.manufacturer_part_number, 'manufacturer_part_number', true),
  normalized_manufacturer_part_number: text(payload.manufacturer_part_number, 'manufacturer_part_number', true).toUpperCase().replace(/[^A-Z0-9]/g, ''),
  model: text(payload.model, 'model'),
  technical_specifications: object(payload.technical_specifications, 'technical_specifications'),
  package_quantity: decimal(payload.package_quantity, 'package_quantity', { fallback: '1' }),
  product_uom: text(payload.product_uom, 'product_uom', true).toUpperCase(),
  product_uom_id: positive(payload.product_uom_id, 'product_uom_id'),
  // Compatibility projection is derived by the service; caller input is not authoritative.
  regulatory_identifiers: object(payload.regulatory_identifiers, 'regulatory_identifiers'),
  technical_notes: text(payload.technical_notes, 'technical_notes'),
});

const catalog = payload => ({
  supplier_id: positive(payload.supplier_id, 'supplier_id'),
  approved_product_id: positive(payload.approved_product_id, 'approved_product_id'),
  supplier_item_code: text(payload.supplier_item_code, 'supplier_item_code', true),
  supplier_description: text(payload.supplier_description, 'supplier_description'),
  purchasing_uom_id: positive(payload.purchasing_uom_id, 'purchasing_uom_id'),
  conversion_factor: decimal(payload.conversion_factor, 'conversion_factor', { fallback: '1' }),
  package_size: decimal(payload.package_size, 'package_size', { fallback: '1' }),
  minimum_order_quantity: decimal(payload.minimum_order_quantity, 'minimum_order_quantity', { fallback: '1' }),
  order_multiple: decimal(payload.order_multiple, 'order_multiple', { fallback: '1' }),
  unit_price: decimal(payload.unit_price, 'unit_price', { allowZero: true }),
  currency: text(payload.currency, 'currency')?.toUpperCase() || null,
  lead_time_days: payload.lead_time_days == null ? null : Number(payload.lead_time_days),
  is_preferred_supplier: Boolean(payload.is_preferred_supplier),
  is_approved_supplier: Boolean(payload.is_approved_supplier),
});

const pending = payload => ({
  proposed_name: text(payload.proposed_name, 'proposed_name', true),
  item_type: text(payload.item_type, 'item_type', true),
  category: text(payload.category, 'category'),
  required_specifications: object(payload.required_specifications, 'required_specifications'),
  intended_use: text(payload.intended_use, 'intended_use', true),
  requested_quantity: positive(payload.requested_quantity, 'requested_quantity'),
  requested_uom: text(payload.requested_uom, 'requested_uom'),
  justification: text(payload.justification, 'justification', true),
  request_id: positive(payload.request_id, 'request_id'),
  requested_item_id: positive(payload.requested_item_id, 'requested_item_id'),
});

module.exports = { LIFECYCLE_TRANSITIONS, genericItem, product, catalog, pending, fingerprint };