'use strict';

const crypto = require('crypto');
const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryRepository = require('../repositories/inventoryRepository');
const { INVENTORY_MOVEMENT_TYPES, ISSUABLE_STOCK_STATUSES } = require('../domain/inventoryMovementTypes');
const { validateInventoryMovement } = require('../validators/inventoryMovementValidator');
const { authorizeInventoryMovement } = require('../policies/inventoryPolicy');
const InventoryError = require('../errors/inventoryError');
const auditService = require('./auditService');
const recalculateAvailableQuantity = require('../utils/recalculateAvailableQuantity');

const fingerprint = (command) => crypto.createHash('sha256').update(JSON.stringify({
  movementType: command.movementType, inventoryItemId: command.inventoryItemId, instituteId: command.instituteId,
  warehouseId: command.warehouseId, destinationWarehouseId: command.destinationWarehouseId || null,
  quantity: command.quantity, sourceQuantity: command.sourceQuantity || command.quantity,
  sourceUom: command.sourceUom || command.baseUom || null, baseUom: command.baseUom || null,
  conversionFactor: command.conversionFactor || 1, stockStatus: command.stockStatus,
  batchNumber: command.batchNumber || null, lotNumber: command.lotNumber || null,
  serialNumber: command.serialNumber || null, expiryDate: command.expiryDate || null,
  sourceDocumentType: command.sourceDocumentType, sourceDocumentId: String(command.sourceDocumentId),
  sourceDocumentLineId: command.sourceDocumentLineId == null ? null : String(command.sourceDocumentLineId),
})).digest('hex');

function existingResult(existing, expectedFingerprint) {
  if (existing.command_fingerprint !== expectedFingerprint) {
    throw new InventoryError('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for a different movement', 409);
  }
  return { idempotent: true, movement: existing, beforeBalance: null, afterBalance: null };
}

async function postValidated(command, client) {
  const repository = new InventoryRepository(client);
  command.commandFingerprint = fingerprint(command);
  await repository.lockPostingKeys(command);
  const duplicate = await repository.findMovementByIdempotencyKey(command.idempotencyKey);
  if (duplicate) return existingResult(duplicate, command.commandFingerprint);

  const warehouse = await repository.validateWarehouse(command.warehouseId, command.instituteId);
  if (!warehouse) throw new InventoryError('WAREHOUSE_SCOPE_DENIED', 'Warehouse is unavailable in the supplied institute', 403);
  authorizeInventoryMovement(command.actor, INVENTORY_MOVEMENT_TYPES[command.movementType], warehouse);
  const item = await repository.validateInventoryItem(command.inventoryItemId);
  if (!item) throw new InventoryError('INVENTORY_ITEM_NOT_FOUND', 'Inventory item was not found', 404);
  if (command.movementType === 'ISSUE' && !ISSUABLE_STOCK_STATUSES.includes(command.stockStatus)) {
    throw new InventoryError('INVALID_STOCK_STATUS', `${command.stockStatus} stock cannot be issued`, 409);
  }

  let balances = await repository.lockInventoryBalances(command);
  const direction = INVENTORY_MOVEMENT_TYPES[command.movementType].direction;
  const before = balances.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (direction === 'OUT' && before < command.quantity) {
    throw new InventoryError('INSUFFICIENT_STOCK', `Available stock ${before} is less than requested quantity ${command.quantity}`, 409, { available: before, requested: command.quantity });
  }
  if (direction === 'IN' && balances.length === 0) balances = [await repository.createInventoryBalance(command, item.name)];

  let remaining = command.quantity;
  const updated = [];
  for (const balance of balances) {
    if (remaining <= 0) break;
    const amount = direction === 'OUT' ? Math.min(remaining, Number(balance.quantity)) : remaining;
    const row = await repository.updateInventoryBalance(balance.id, direction === 'OUT' ? -amount : amount, command.actor.id);
    if (!row) throw new InventoryError('INSUFFICIENT_STOCK', 'Inventory changed while posting; retry the operation', 409);
    updated.push(row); remaining -= amount;
  }
  const signedQuantity = direction === 'OUT' ? -command.quantity : direction === 'IN' ? command.quantity : 0;
  const movement = await repository.insertInventoryMovement(command, signedQuantity, item);
  await recalculateAvailableQuantity(client, command.inventoryItemId);
  const after = before + signedQuantity;
  await auditService.writeAuditEvent({
    entityType: 'inventory_movement', entityId: movement.id, action: 'inventory.movement.posted',
    actorUserId: command.actor.id, instituteId: command.instituteId, correlationId: command.correlationId,
    beforeData: { quantity: before }, afterData: { quantity: after }, reason: command.reason,
    metadata: { movementType: command.movementType, inventoryItemId: command.inventoryItemId,
      warehouseId: command.warehouseId, destinationWarehouseId: command.destinationWarehouseId || null,
      quantity: command.quantity, baseUom: movement.base_uom, sourceDocumentType: command.sourceDocumentType,
      sourceDocumentId: command.sourceDocumentId, batchNumber: command.batchNumber || null,
      serialNumber: command.serialNumber || null }, client,
  });
  return { idempotent: false, movement, beforeBalance: before, afterBalance: after, balances: updated };
}

async function postMovement(rawCommand, suppliedClient = null) {
  const command = validateInventoryMovement(rawCommand);
  return withTransaction((client) => postValidated(command, client), { client: suppliedClient, pool });
}

async function postMovements(rawCommands, suppliedClient = null) {
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) throw new InventoryError('INVALID_MOVEMENT_BATCH', 'At least one movement is required');
  const commands = rawCommands.map(validateInventoryMovement).sort((a, b) =>
    a.warehouseId - b.warehouseId || a.inventoryItemId - b.inventoryItemId ||
    String(a.batchNumber || a.lotNumber || a.serialNumber || '').localeCompare(String(b.batchNumber || b.lotNumber || b.serialNumber || '')));
  return withTransaction(async (client) => {
    const results = [];
    for (const command of commands) results.push(await postValidated(command, client));
    return results;
  }, { client: suppliedClient, pool });
}

module.exports = { postMovement, postMovements, fingerprint, postValidated };