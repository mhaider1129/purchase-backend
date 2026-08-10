'use strict';

const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryRepository = require('../repositories/inventoryRepository');
const { REVERSAL_TYPES } = require('../domain/inventoryMovementTypes');
const InventoryError = require('../errors/inventoryError');
const inventoryPostingService = require('./inventoryPostingService');

function buildReversalCommand(original, { reason, actor, idempotencyKey, correlationId, allocations = [] }) {
  return {
    movementType: REVERSAL_TYPES[original.movement_type], inventoryItemId: original.stock_item_id, instituteId: original.institute_id,
    warehouseId: original.warehouse_id, quantity: Math.abs(Number(original.quantity)),
    baseUom: original.base_uom, sourceQuantity: original.source_quantity,
    sourceUom: original.source_uom, conversionFactor: original.conversion_factor,
    batchNumber: original.batch_number, lotNumber: original.lot_number,
    serialNumber: original.serial_number, expiryDate: original.expiry_date,
    stockStatus: original.stock_status, sourceDocumentType: 'inventory_movement_reversal',
    sourceDocumentId: original.id, reason: String(reason).trim(), actor, idempotencyKey,
    correlationId, reversalOfMovementId: original.id,
    allocationOverrides: allocations.map((allocation) => ({
      warehouseStockLevelId: allocation.warehouse_stock_level_id,
      quantity: -Number(allocation.quantity),
    })),
    metadata: {
      reversedMovementId: original.id, originalMovementId: original.id,
      originalDepartmentId: original.department_id || null,
      originalDestination: original.destination_location || null,
      originalSourceDocumentType: original.source_document_type || null,
      originalSourceDocumentId: original.source_document_id || null,
      originalSourceDocumentLineId: original.source_document_line_id || null,
    },
  };
}

async function reverseMovement({ movementId, reason, actor, idempotencyKey, correlationId }, suppliedClient = null) {
  if (!reason || !String(reason).trim()) throw new InventoryError('REASON_REQUIRED', 'A reversal reason is required');
  if (!idempotencyKey) throw new InventoryError('INVALID_IDEMPOTENCY_KEY', 'A reversal idempotencyKey is required');
  return withTransaction(async (client) => {
    const repository = new InventoryRepository(client);
    const originalResult = await repository.lockMovementForReversal(movementId);
    if (!originalResult) throw new InventoryError('MOVEMENT_NOT_FOUND', 'Inventory movement was not found', 404);
    const { movement: original, allocations } = originalResult;
    const movementType = REVERSAL_TYPES[original.movement_type];
    if (!movementType) throw new InventoryError('MOVEMENT_NOT_REVERSIBLE', 'This movement type cannot be reversed', 409);
    if (!allocations.length) throw new InventoryError('LEGACY_MOVEMENT_UNALLOCATED', 'Legacy movement has no exact allocations and cannot be automatically reversed', 409);
    const reversalCommand = buildReversalCommand(original, {
      reason, actor, idempotencyKey, correlationId, allocations,
    });
    if (original.reversed_by_movement_id) {
      const retry = await repository.findMovementWithAllocationsByIdempotencyKey(idempotencyKey);
      if (!retry || Number(retry.movement.id) !== Number(original.reversed_by_movement_id)) {
        throw new InventoryError('MOVEMENT_ALREADY_REVERSED', 'Inventory movement has already been reversed', 409);
      }
    }
    const result = await inventoryPostingService.postMovement(reversalCommand, client);
    if (!result.idempotent) await repository.markMovementReversed(original.id, result.movement.id);
    return result;
  }, { client: suppliedClient, pool });
}

module.exports = { reverseMovement, buildReversalCommand };