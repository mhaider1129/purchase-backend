'use strict';

// Canonical UOM arithmetic. Values cross the service boundary as decimal strings;
// BigInt coefficients ensure packaging math never passes through IEEE-754 Number.
const DECIMAL = /^\+?(\d+)(?:\.(\d+))?$/;

function parseDecimal(value, name, { allowZero = false } = {}) {
  const match = DECIMAL.exec(String(value ?? '').trim());
  if (!match) throw new RangeError(`${name} must be an exact decimal`);
  const scale = (match[2] || '').length;
  const coefficient = BigInt(`${match[1]}${match[2] || ''}`);
  if ((!allowZero && coefficient <= 0n) || coefficient < 0n) throw new RangeError(`${name} must be ${allowZero ? 'non-negative' : 'positive'}`);
  return { coefficient, scale };
}

function formatDecimal(coefficient, scale) {
  const padded = String(coefficient).padStart(scale + 1, '0');
  const value = scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}` : padded;
  return value.replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '').replace(/\.$/, '');
}

function multiply(...values) {
  const parts = values.map((value, index) => parseDecimal(value, `factor_${index + 1}`));
  return formatDecimal(parts.reduce((total, part) => total * part.coefficient, 1n), parts.reduce((total, part) => total + part.scale, 0));
}

function validateGenericUomConfiguration({ itemType, baseUomId, inventoryUomId }) {
  const service = String(itemType || '').toLowerCase() === 'service';
  if (!service && (!baseUomId || !inventoryUomId)) throw new RangeError('Stockable Generic Items require base and inventory UOMs');
  return true;
}

function validateProductPackaging({ packageQuantity, productUom }) {
  parseDecimal(packageQuantity, 'package_quantity');
  if (!productUom) throw new RangeError('product_uom is required');
  return true;
}

function validateSupplierPackaging({ conversionFactor, purchasingUom, minimumOrderQuantity = '1', orderMultiple = '1' }) {
  parseDecimal(conversionFactor, 'conversion_factor');
  parseDecimal(minimumOrderQuantity, 'minimum_order_quantity');
  parseDecimal(orderMultiple, 'order_multiple');
  if (!purchasingUom) throw new RangeError('purchasing_uom is required');
  return true;
}

function calculateBaseQuantity({ sourceQuantity, supplierConversionFactor = '1', productPackageQuantity = '1' }) {
  return multiply(sourceQuantity, supplierConversionFactor, productPackageQuantity);
}

function assertUniversalConversion({ fromUom, toUom, fromIsPackaging = false, toIsPackaging = false }) {
  if (fromIsPackaging || toIsPackaging || ['BOX', 'CASE', 'VIAL'].includes(String(fromUom).toUpperCase())) {
    throw new RangeError('Item-specific packaging cannot be registered as a universal conversion');
  }
  if (!fromUom || !toUom || String(fromUom).toUpperCase() === String(toUom).toUpperCase()) throw new RangeError('A universal conversion requires two different units');
  return true;
}

// Compatibility APIs for the contained legacy Item Master. New governed paths use
// calculateBaseQuantity and retain decimal strings.
const validateUnitsPerPackage = value => {
  const parsed = parseDecimal(value, 'units_per_package');
  if (parsed.scale || parsed.coefficient > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('units_per_package must be a positive integer');
  return Number(parsed.coefficient);
};
const packageQuantityToBaseQuantity = (quantity, units) => Number(multiply(quantity, validateUnitsPerPackage(units)));
const packagePriceToBaseUnitCost = (price, units) => Number((Number(price) / validateUnitsPerPackage(units)).toFixed(6));
const baseQuantityToPackageQuantity = (base, units) => {
  const parsed = parseDecimal(base, 'base_quantity'); const divisor = BigInt(validateUnitsPerPackage(units));
  if (parsed.coefficient % divisor) throw new RangeError('base_quantity is not exactly divisible by units_per_package');
  return Number(formatDecimal(parsed.coefficient / divisor, parsed.scale));
};
const normalizeUomLabel = value => { const label = String(value || '').trim().replace(/\s+/g, ' '); return label || null; };

module.exports = { parseDecimal, multiply, validateGenericUomConfiguration, validateProductPackaging,
  validateSupplierPackaging, calculateBaseQuantity, assertUniversalConversion, validateUnitsPerPackage,
  packageQuantityToBaseQuantity, packagePriceToBaseUnitCost, baseQuantityToPackageQuantity, normalizeUomLabel };