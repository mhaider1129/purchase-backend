'use strict';
const { parseDecimal, formatDecimal } = require('../purchaseOrderTotalsService');

function verifiedHardSavings({ baselineAmount, finalAmount, currency }) {
  if (!/^[A-Z]{3}$/.test(String(currency || ''))) throw new TypeError('ISO currency is required');
  const value = parseDecimal(baselineAmount) - parseDecimal(finalAmount);
  if (value < 0n) throw new RangeError('Final amount exceeds savings baseline');
  return { valueType: 'HARD_SAVINGS', verifiedValue: formatDecimal(value), currency };
}

function aggregateByCurrency(events = []) {
  const result = {};
  for (const event of events) {
    const key = `${event.valueType}:${event.currency}`;
    result[key] = formatDecimal((result[key] ? parseDecimal(result[key]) : 0n) + parseDecimal(event.verifiedValue));
  }
  return result;
}

function weightedCreditDays(awards = []) {
  let value = 0n; let weighted = 0n;
  for (const award of awards) {
    const amount = parseDecimal(award.amount);
    value += amount;
    weighted += amount * BigInt(award.creditDays || 0);
  }
  return value === 0n ? null : Number(weighted / value);
}

module.exports = { verifiedHardSavings, aggregateByCurrency, weightedCreditDays };