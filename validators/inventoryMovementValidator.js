'use strict';

const { INVENTORY_MOVEMENT_TYPES, STOCK_STATUSES } = require('../domain/inventoryMovementTypes');
const InventoryError = require('../errors/inventoryError');

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function validateInventoryMovement(command) {
  const type = INVENTORY_MOVEMENT_TYPES[command?.movementType];
  if (!type) throw new InventoryError('INVALID_MOVEMENT_TYPE', 'A supported movementType is required');
  if (type.genericPostingSupported === false) throw new InventoryError('UNSUPPORTED_MOVEMENT', `${command.movementType} is not supported by generic Phase 3A posting`, 501);
  if (!integer(command.inventoryItemId)) throw new InventoryError('INVALID_INVENTORY_ITEM', 'A valid inventoryItemId is required');
  if (!integer(command.instituteId)) throw new InventoryError('INVALID_INSTITUTE', 'A valid instituteId is required');
  if (!integer(command.warehouseId)) throw new InventoryError('INVALID_WAREHOUSE', 'A valid warehouseId is required');
  const quantity = Number(command.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InventoryError('INVALID_QUANTITY', 'quantity must be a positive number');
  if (!text(command.idempotencyKey) || command.idempotencyKey.trim().length > 200) throw new InventoryError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotencyKey is required');
  if (type.requiresSourceDocument && (!text(command.sourceDocumentType) || command.sourceDocumentId == null)) {
    throw new InventoryError('SOURCE_DOCUMENT_REQUIRED', 'sourceDocumentType and sourceDocumentId are required');
  }
  if (type.requiresDestinationWarehouse && !integer(command.destinationWarehouseId)) throw new InventoryError('DESTINATION_WAREHOUSE_REQUIRED', 'A valid destinationWarehouseId is required');
  if (type.requiresReason && !text(command.reason)) throw new InventoryError('REASON_REQUIRED', 'A reason is required');
  const status = command.stockStatus || 'AVAILABLE';
  if (!STOCK_STATUSES.includes(status)) throw new InventoryError('INVALID_STOCK_STATUS', `Unsupported stock status: ${status}`);
  for (const [name, value] of [['batchNumber', command.batchNumber], ['lotNumber', command.lotNumber], ['serialNumber', command.serialNumber]]) {
    if (value != null && (!text(value) || value.trim().length > 120)) throw new InventoryError('INVALID_TRACKING_VALUE', `${name} is invalid`);
  }
  return { ...command, inventoryItemId: Number(command.inventoryItemId), instituteId: Number(command.instituteId), warehouseId: Number(command.warehouseId), quantity, stockStatus: status, idempotencyKey: command.idempotencyKey.trim() };
}

module.exports = { validateInventoryMovement };