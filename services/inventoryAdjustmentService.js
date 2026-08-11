'use strict';

const InventoryError = require('../errors/inventoryError');
const { hasPermission } = require('../policies/inventoryPolicy');
const { postMovement } = require('./inventoryPostingService');

async function adjustInventory(input, client = null) {
  if (!input?.actor || !hasPermission(input.actor, 'inventory.adjust')) throw new InventoryError('INVENTORY_PERMISSION_DENIED', 'Permission required: inventory.adjust', 403);
  if (typeof input.reason !== 'string' || !input.reason.trim()) throw new InventoryError('REASON_REQUIRED', 'A reason is required', 400);
  if (!input.sourceDocumentType || input.sourceDocumentId == null) throw new InventoryError('SOURCE_DOCUMENT_REQUIRED', 'A source document/reference is required', 400);
  const direction = String(input.type || input.adjustmentType || '').toUpperCase();
  if (!['POSITIVE', 'NEGATIVE', 'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT'].includes(direction)) throw new InventoryError('INVALID_ADJUSTMENT_TYPE', 'Adjustment type must be positive or negative', 400);
  return postMovement({
    ...input,
    movementType: direction.startsWith('POSITIVE') ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT',
    reason: input.reason.trim(),
    stockStatus: input.stockStatus || 'AVAILABLE',
    metadata: { ...(input.metadata || {}), adjustmentReason: input.reason.trim() },
  }, client);
}

module.exports = { adjustInventory, positive: (input, client) => adjustInventory({ ...input, type: 'POSITIVE' }, client), negative: (input, client) => adjustInventory({ ...input, type: 'NEGATIVE' }, client) };