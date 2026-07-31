const createHttpError = require('../utils/httpError');

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  'name', 'description', 'category', 'subcategory', 'sub_category', 'manufacturer',
  'manufacturer_part_number', 'product_specification', 'inventory_uom', 'unit',
  'batch', 'batch_number', 'expiry_date', 'serial_number', 'consignment',
]);

function invalid(details) {
  const error = createHttpError(400, 'Request validation failed');
  error.code = 'validation_failed';
  error.details = details;
  return error;
}

function validateAddToInventoryPayload(value) {
  const body = value || {};
  const errors = [];
  Object.keys(body).filter((key) => FORBIDDEN_IDENTITY_FIELDS.has(key)).forEach((field) => {
    errors.push({ field, code: field === 'consignment' ? 'boolean' : 'derived_identity_field' });
  });
  for (const field of ['generic_item_id', 'inventory_uom_id']) {
    if (!Number.isInteger(body[field]) || body[field] <= 0) errors.push({ field, code: 'positive_integer' });
  }
  if (body.approved_product_id != null && (!Number.isInteger(body.approved_product_id) || body.approved_product_id <= 0)) {
    errors.push({ field: 'approved_product_id', code: 'positive_integer' });
  }
  if (body.warehouse_configurations != null && !Array.isArray(body.warehouse_configurations)) {
    errors.push({ field: 'warehouse_configurations', code: 'array' });
  }
  const seen = new Set();
  (body.warehouse_configurations || []).forEach((configuration, index) => {
    const prefix = `warehouse_configurations.${index}`;
    if (!Number.isInteger(configuration?.warehouse_id) || configuration.warehouse_id <= 0) {
      errors.push({ field: `${prefix}.warehouse_id`, code: 'positive_integer' });
    } else if (seen.has(configuration.warehouse_id)) {
      errors.push({ field: `${prefix}.warehouse_id`, code: 'duplicate' });
    } else seen.add(configuration.warehouse_id);
    const initialQuantity = configuration?.initial_quantity ?? 0;
    if (typeof initialQuantity !== 'number' || !Number.isFinite(initialQuantity) || initialQuantity < 0) {
      errors.push({ field: `${prefix}.initial_quantity`, code: 'non_negative_number' });
    } else if (initialQuantity !== 0) {
      errors.push({ field: `${prefix}.initial_quantity`, code: 'inventory_transaction_required' });
    }
    const policy = configuration?.replenishment_policy;
    if (policy != null && (typeof policy !== 'object' || Array.isArray(policy))) {
      errors.push({ field: `${prefix}.replenishment_policy`, code: 'object' });
      return;
    }
    ['reorder_point', 'safety_stock', 'lot_size'].forEach((field) => {
      if (policy?.[field] != null && (typeof policy[field] !== 'number' || !Number.isFinite(policy[field]) || policy[field] < 0)) {
        errors.push({ field: `${prefix}.replenishment_policy.${field}`, code: 'non_negative_number' });
      }
    });
    ['lead_time_days', 'review_period_days'].forEach((field) => {
      if (policy?.[field] != null && (!Number.isInteger(policy[field]) || policy[field] < 0)) {
        errors.push({ field: `${prefix}.replenishment_policy.${field}`, code: 'non_negative_integer' });
      }
    });
    if (policy?.is_active != null && typeof policy.is_active !== 'boolean') {
      errors.push({ field: `${prefix}.replenishment_policy.is_active`, code: 'boolean' });
    }
  });
  if (errors.length) throw invalid(errors);
  return { ...body, warehouse_configurations: (body.warehouse_configurations || []).map((row) => ({ ...row, initial_quantity: row.initial_quantity ?? 0 })) };
}

module.exports = { FORBIDDEN_IDENTITY_FIELDS, validateAddToInventoryPayload };