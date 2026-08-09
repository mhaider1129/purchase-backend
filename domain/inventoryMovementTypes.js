'use strict';

const definition = (direction, options = {}) => Object.freeze({
  direction,
  changesStockStatus: false,
  requiresSourceDocument: true,
  requiresDestinationWarehouse: false,
  requiresReason: false,
  reversible: true,
  permission: direction === 'IN' ? 'inventory.receive' : 'inventory.issue',
  ...options,
});

const INVENTORY_MOVEMENT_TYPES = Object.freeze({
  GOODS_RECEIPT: definition('IN'),
  GOODS_RECEIPT_REVERSAL: definition('OUT', { permission: 'inventory.reverse', requiresReason: true }),
  ISSUE: definition('OUT'),
  ISSUE_REVERSAL: definition('IN', { permission: 'inventory.reverse', requiresReason: true }),
  // Generic posting cannot coordinate the destination lifecycle atomically; Phase 3B owns transfers.
  TRANSFER_DISPATCH: definition('OUT', { requiresDestinationWarehouse: true, permission: 'inventory.transfer', genericPostingSupported: false }),
  TRANSFER_RECEIPT: definition('IN', { requiresDestinationWarehouse: true, permission: 'inventory.transfer', genericPostingSupported: false }),
  POSITIVE_ADJUSTMENT: definition('IN', { requiresReason: true, permission: 'inventory.adjust' }),
  NEGATIVE_ADJUSTMENT: definition('OUT', { requiresReason: true, permission: 'inventory.adjust' }),
  // Status transfers require two atomic projection updates and are deferred to Phase 3B.
  QUARANTINE: definition('STATUS', { changesStockStatus: true, requiresReason: true, permission: 'inventory.adjust', genericPostingSupported: false }),
  RELEASE_FROM_QUARANTINE: definition('STATUS', { changesStockStatus: true, requiresReason: true, permission: 'inventory.adjust', genericPostingSupported: false }),
});

const REVERSAL_TYPES = Object.freeze({
  GOODS_RECEIPT: 'GOODS_RECEIPT_REVERSAL',
  ISSUE: 'ISSUE_REVERSAL',
  GOODS_RECEIPT_REVERSAL: 'GOODS_RECEIPT',
  ISSUE_REVERSAL: 'ISSUE',
  POSITIVE_ADJUSTMENT: 'NEGATIVE_ADJUSTMENT',
  NEGATIVE_ADJUSTMENT: 'POSITIVE_ADJUSTMENT',
});

const STOCK_STATUSES = Object.freeze(['AVAILABLE', 'QUARANTINE', 'BLOCKED', 'RECALLED', 'DAMAGED', 'EXPIRED']);
const ISSUABLE_STOCK_STATUSES = Object.freeze(['AVAILABLE']);

module.exports = { INVENTORY_MOVEMENT_TYPES, REVERSAL_TYPES, STOCK_STATUSES, ISSUABLE_STOCK_STATUSES };