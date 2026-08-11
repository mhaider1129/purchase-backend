'use strict';

const InventoryError = require('../errors/inventoryError');
const ISSUABLE_STATUSES = Object.freeze(['AVAILABLE']);

const normalizeTracking = (value) => value == null || value === '' ? null : String(value).trim();

function compareFefo(left, right) {
  const leftExpiry = left.expiry_date == null ? Number.POSITIVE_INFINITY : new Date(left.expiry_date).getTime();
  const rightExpiry = right.expiry_date == null ? Number.POSITIVE_INFINITY : new Date(right.expiry_date).getTime();
  return leftExpiry - rightExpiry || Number(left.id) - Number(right.id);
}

function selectEligibleBalances(balances, selection = {}, trackingPolicy = {}) {
  const serial = normalizeTracking(selection.serialNumber);
  if (trackingPolicy.serialControlled && !serial) {
    throw new InventoryError('SERIAL_SELECTION_REQUIRED', 'Serial-controlled stock requires an exact serial selection', 400);
  }
  return balances.filter((row) => ISSUABLE_STATUSES.includes(row.stock_status) && Number(row.quantity) - Number(row.reserved_quantity || 0) > 0)
    .filter((row) => !serial || row.serial_number === serial)
    .filter((row) => !selection.batchNumber || row.batch_number === selection.batchNumber)
    .filter((row) => !selection.lotNumber || row.lot_number === selection.lotNumber)
    .sort(compareFefo);
}

const sqlOrderBy = 'expiry_date ASC NULLS LAST, id ASC';
module.exports = { ISSUABLE_STATUSES, compareFefo, selectEligibleBalances, sqlOrderBy };