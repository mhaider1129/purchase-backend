'use strict';

const QUANTITY_SCALE = 6;
const COST_SCALE = 6;

const round = (value, scale) => Number(Number(value).toFixed(scale));

function positive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be a positive number`);
  return number;
}

function validateUnitsPerPackage(value) {
  const number = positive(value, 'units_per_package');
  if (!Number.isInteger(number)) throw new RangeError('units_per_package must be a positive integer');
  return number;
}

function packageQuantityToBaseQuantity(packageQuantity, unitsPerPackage) {
  return round(positive(packageQuantity, 'package_quantity') * validateUnitsPerPackage(unitsPerPackage), QUANTITY_SCALE);
}

function packagePriceToBaseUnitCost(packagePrice, unitsPerPackage) {
  const price = Number(packagePrice);
  if (!Number.isFinite(price) || price < 0) throw new RangeError('package_price must be a non-negative number');
  return round(price / validateUnitsPerPackage(unitsPerPackage), COST_SCALE);
}

function baseQuantityToPackageQuantity(baseQuantity, unitsPerPackage) {
  const base = positive(baseQuantity, 'base_quantity');
  const units = validateUnitsPerPackage(unitsPerPackage);
  const result = round(base / units, QUANTITY_SCALE);
  if (round(result * units, QUANTITY_SCALE) !== round(base, QUANTITY_SCALE)) {
    throw new RangeError('base_quantity is not exactly divisible by units_per_package');
  }
  return result;
}

function normalizeUomLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ');
  if (!label) return null;
  const safe = { pcs: 'piece', pc: 'piece', pieces: 'piece', boxes: 'box', cases: 'case', units: 'unit' };
  return safe[label.toLowerCase()] || label;
}

module.exports = { QUANTITY_SCALE, COST_SCALE, validateUnitsPerPackage, packageQuantityToBaseQuantity,
  packagePriceToBaseUnitCost, baseQuantityToPackageQuantity, normalizeUomLabel };