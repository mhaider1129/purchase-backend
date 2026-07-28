const createHttpError = require('../utils/httpError');

const IDENTITY_FIELDS = new Set([
  'name', 'description', 'category', 'subcategory', 'sub_category', 'manufacturer',
  'manufacturer_part_number', 'product_specification', 'inventory_uom',
]);
const VALUATION_METHODS = new Set(['fifo', 'weighted_average', 'standard_cost']);
const STOCKING_POLICIES = new Set(['stocked', 'non_stocked', 'on_demand']);

function validationError(errors) {
  const error = createHttpError(400, 'Request validation failed');
  error.details = errors;
  return error;
}

function positiveId(value, field, errors, required = false) {
  if (value == null && !required) return;
  if (!Number.isInteger(value) || value <= 0) errors.push({ field, code: 'positive_integer' });
}

function nonNegativeNumber(value, field, errors) {
  if (value == null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push({ field, code: 'non_negative_number' });
  }
}

function strictBoolean(value, field, errors) {
  if (value != null && typeof value !== 'boolean') errors.push({ field, code: 'boolean' });
}

function validateAddToInventory(req, _res, next) {
  const body = req.body || {};
  const errors = [];
  for (const field of Object.keys(body)) {
    if (IDENTITY_FIELDS.has(field)) errors.push({ field, code: 'derived_identity_field' });
  }
  positiveId(body.generic_item_id, 'generic_item_id', errors, true);
  positiveId(body.approved_product_id, 'approved_product_id', errors);
  positiveId(body.inventory_uom_id, 'inventory_uom_id', errors, true);
  for (const field of ['minimum_stock', 'maximum_stock', 'reorder_point', 'reorder_quantity']) {
    nonNegativeNumber(body[field], field, errors);
  }
  if (body.minimum_stock != null && body.maximum_stock != null && body.minimum_stock > body.maximum_stock) {
    errors.push({ field: 'minimum_stock', code: 'exceeds_maximum_stock' });
  }
  for (const field of ['batch_tracking', 'expiry_tracking', 'serial_tracking', 'consignment', 'quarantine_required', 'active']) {
    strictBoolean(body[field], field, errors);
  }
  if (body.valuation_method != null && !VALUATION_METHODS.has(body.valuation_method)) {
    errors.push({ field: 'valuation_method', code: 'unsupported_value' });
  }
  if (body.stocking_policy != null && !STOCKING_POLICIES.has(body.stocking_policy)) {
    errors.push({ field: 'stocking_policy', code: 'unsupported_value' });
  }
  if (body.warehouse_assignments != null && !Array.isArray(body.warehouse_assignments)) {
    errors.push({ field: 'warehouse_assignments', code: 'array' });
  } else {
    (body.warehouse_assignments || []).forEach((assignment, index) => {
      positiveId(assignment?.warehouse_id, `warehouse_assignments.${index}.warehouse_id`, errors, true);
      if (assignment?.bin_location_id != null) positiveId(assignment.bin_location_id, `warehouse_assignments.${index}.bin_location_id`, errors);
    });
  }
  return errors.length ? next(validationError(errors)) : next();
}

function validateApplyMapping(req, _res, next) {
  const body = req.body || {};
  const errors = [];
  positiveId(body.stock_item_id, 'stock_item_id', errors, true);
  positiveId(body.mapping_id, 'mapping_id', errors, true);
  positiveId(body.generic_item_id, 'generic_item_id', errors, true);
  positiveId(body.approved_product_id, 'approved_product_id', errors);
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
    errors.push({ field: 'notes', code: 'text_max_2000' });
  }
  return errors.length ? next(validationError(errors)) : next();
}

module.exports = { validateAddToInventory, validateApplyMapping };