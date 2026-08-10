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
  allocationOverrides: (command.allocationOverrides || []).map((allocation) => ({
    warehouseStockLevelId: allocation.warehouseStockLevelId, quantity: Number(allocation.quantity),
  })),
})).digest('hex');

function existingResult(existingResultValue, expectedFingerprint) {
  const { movement, allocations } = existingResultValue;
  if (movement.command_fingerprint !== expectedFingerprint) {
    throw new InventoryError('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for a different movement', 409);
  }
  return { idempotent: true, movement, allocations, beforeBalance: null, afterBalance: null };
}

async function postValidated(command, client) {
  const repository = new InventoryRepository(client);
  command.commandFingerprint = fingerprint(command);
  await repository.lockPostingKeys(command);
  const duplicate = await repository.findMovementWithAllocationsByIdempotencyKey(command.idempotencyKey);
  if (duplicate) return existingResult(duplicate, command.commandFingerprint);

  const warehouse = await repository.validateWarehouse(command.warehouseId, command.instituteId);
  if (!warehouse) throw new InventoryError('WAREHOUSE_SCOPE_DENIED', 'Warehouse is unavailable in the supplied institute', 403);
  authorizeInventoryMovement(command.actor, INVENTORY_MOVEMENT_TYPES[command.movementType], warehouse);
  const item = await repository.validateInventoryItem(command.inventoryItemId);
  if (!item) throw new InventoryError('INVENTORY_ITEM_NOT_FOUND', 'Inventory item was not found', 404);
  if (command.movementType === 'ISSUE' && !ISSUABLE_STOCK_STATUSES.includes(command.stockStatus)) {
    throw new InventoryError('INVALID_STOCK_STATUS', `${command.stockStatus} stock cannot be issued`, 409);
  }

  const direction = INVENTORY_MOVEMENT_TYPES[command.movementType].direction;
  let balances;
  if (command.allocationOverrides?.length) {
    balances = [];
    for (const allocation of command.allocationOverrides) {
      const balance = await repository.lockInventoryBalanceById(allocation.warehouseStockLevelId, command);
      if (!balance) throw new InventoryError('EXACT_REVERSAL_IMPOSSIBLE', 'An original inventory balance identity is no longer available', 409);
      balances.push({ ...balance, reversalQuantity: Math.abs(Number(allocation.quantity)) });
    }
  } else {
    balances = direction === 'IN'
      ? await repository.lockExactInventoryBalance(command)
      : await repository.lockEligibleOutboundBalances(command);
  }
  const before = balances.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (direction === 'OUT' && (before < command.quantity || balances.some((row) => row.reversalQuantity && Number(row.quantity) < row.reversalQuantity))) {
    throw new InventoryError('INSUFFICIENT_STOCK', `Available stock ${before} is less than requested quantity ${command.quantity}`, 409, { available: before, requested: command.quantity });
  }
  if (direction === 'IN' && balances.length === 0) balances = [await repository.createInventoryBalance(command, item.name)];

  let remaining = command.quantity;
  const updated = [];
  const allocationDrafts = [];
  for (const balance of balances) {
    if (remaining <= 0) break;
    const amount = balance.reversalQuantity || (direction === 'OUT' ? Math.min(remaining, Number(balance.quantity)) : remaining);
    const row = await repository.updateInventoryBalance(balance.id, direction === 'OUT' ? -amount : amount, command.actor.id);
    if (!row) throw new InventoryError('INSUFFICIENT_STOCK', 'Inventory changed while posting; retry the operation', 409);
    updated.push(row);
    allocationDrafts.push({
      warehouseStockLevelId: balance.id, warehouseId: balance.warehouse_id,
      inventoryItemId: balance.stock_item_id, stockStatus: balance.stock_status,
      quantity: direction === 'OUT' ? -amount : amount, batchNumber: balance.batch_number || null,
      lotNumber: balance.lot_number || null, serialNumber: balance.serial_number || null,
      expiryDate: balance.expiry_date || null, baseUom: command.baseUom || item.inventory_uom || item.unit,
      sequence: allocationDrafts.length + 1,
    });
    remaining -= amount;
  }
  const signedQuantity = direction === 'OUT' ? -command.quantity : direction === 'IN' ? command.quantity : 0;
  const allocationTotal = allocationDrafts.reduce((sum, allocation) => sum + allocation.quantity, 0);
  if (remaining !== 0 || Math.abs(allocationTotal - signedQuantity) > 1e-9) {
    throw new InventoryError('ALLOCATION_MISMATCH', 'Inventory allocations do not equal the parent movement quantity', 409);
  }
  const movement = await repository.insertInventoryMovement(command, signedQuantity, item);
  const allocations = await repository.insertInventoryAllocations(movement.id, allocationDrafts);
  await recalculateAvailableQuantity(client, command.inventoryItemId);
  const after = before + signedQuantity;
  await auditService.writeAuditEvent({
    entityType: 'inventory_movement', entityId: movement.id, action: 'inventory.movement.posted',
    actorUserId: command.actor.id, instituteId: command.instituteId, correlationId: command.correlationId,
    beforeData: { quantity: before }, afterData: { quantity: after }, reason: command.reason,
    metadata: { movementType: command.movementType, inventoryItemId: command.inventoryItemId,
      warehouseId: command.warehouseId, destinationWarehouseId: command.destinationWarehouseId || null,
      quantity: command.quantity, baseUom: movement.base_uom, sourceDocumentType: command.sourceDocumentType,
      sourceDocumentId: command.sourceDocumentId, allocationCount: allocations.length,
      allocations: allocations.map((allocation) => ({ balanceId: allocation.warehouse_stock_level_id,
        quantity: Number(allocation.quantity), batchNumber: allocation.batch_number, lotNumber: allocation.lot_number,
        serialNumber: allocation.serial_number, expiryDate: allocation.expiry_date })) }, client,
  });
  return { idempotent: false, movement, allocations, beforeBalance: before, afterBalance: after, balances: updated };
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