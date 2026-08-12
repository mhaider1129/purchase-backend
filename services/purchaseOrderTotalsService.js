'use strict';

const SCALE = 4n;
const FACTOR = 10n ** SCALE;

const parseDecimal = (value = 0) => {
  const text = String(value ?? 0).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new TypeError(`Invalid decimal: ${value}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const scaled = BigInt(whole) * FACTOR + BigInt((fraction + '0000').slice(0, 4));
  return negative ? -scaled : scaled;
};
const formatDecimal = (scaled, places = 2) => {
  const divisor = 10n ** (SCALE - BigInt(places));
  const rounded = (scaled + (scaled >= 0n ? divisor / 2n : -(divisor / 2n))) / divisor;
  const factor = 10n ** BigInt(places);
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? '-' : ''}${absolute / factor}.${String(absolute % factor).padStart(places, '0')}`;
};
const multiply = (left, right) => (left * right + FACTOR / 2n) / FACTOR;
const compareDecimal = (left, right) => {
  const difference = parseDecimal(left) - parseDecimal(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
const addDecimal = (...values) => formatDecimal(values.reduce((sum, value) => sum + parseDecimal(value), 0n));
const subtractDecimal = (left, ...values) => formatDecimal(values.reduce((result, value) => result - parseDecimal(value), parseDecimal(left)));

const calculateLine = (line) => {
  const subtotal = multiply(parseDecimal(line.quantity), parseDecimal(line.unit_price));
  const discount = line.discount_amount != null
    ? parseDecimal(line.discount_amount)
    : multiply(subtotal, parseDecimal(line.discount_percent || 0)) / 100n;
  const taxable = subtotal - discount;
  const tax = line.tax_amount != null
    ? parseDecimal(line.tax_amount)
    : multiply(taxable, parseDecimal(line.tax_percent || 0)) / 100n;
  if (subtotal < 0n || discount < 0n || tax < 0n || discount > subtotal) throw new RangeError('Invalid line financial values');
  return { line_subtotal: formatDecimal(subtotal), discount: formatDecimal(discount), tax: formatDecimal(tax), line_total: formatDecimal(taxable + tax) };
};

const calculatePurchaseOrderTotals = ({ lines = [], freight = 0, charges = 0 }) => {
  const calculatedLines = lines.map(calculateLine);
  const sum = (field) => calculatedLines.reduce((total, line) => total + parseDecimal(line[field]), 0n);
  const subtotal = sum('line_subtotal');
  const discount = sum('discount');
  const tax = sum('tax');
  const extras = parseDecimal(freight) + parseDecimal(charges);
  return { lines: calculatedLines, subtotal: formatDecimal(subtotal), discount: formatDecimal(discount), tax: formatDecimal(tax), freight: formatDecimal(parseDecimal(freight)), charges: formatDecimal(parseDecimal(charges)), grand_total: formatDecimal(subtotal - discount + tax + extras) };
};

module.exports = { parseDecimal, formatDecimal, compareDecimal, addDecimal, subtractDecimal, calculateLine, calculatePurchaseOrderTotals };