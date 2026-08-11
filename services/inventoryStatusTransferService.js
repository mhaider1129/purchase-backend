'use strict';

const pool = require('../config/db');
const withTransaction = require('../utils/withTransaction');
const InventoryError = require('../errors/inventoryError');
const { hasPermission } = require('../policies/inventoryPolicy');
const { postStatusTransferMovement } = require('./inventoryPostingService');

const ALLOWED = new Set(['AVAILABLE:QUARANTINE','QUARANTINE:AVAILABLE','AVAILABLE:RECALLED','RECALLED:AVAILABLE','AVAILABLE:BLOCKED','BLOCKED:AVAILABLE','AVAILABLE:DAMAGED','AVAILABLE:EXPIRED']);
const permissionFor = (from, to) => to === 'QUARANTINE' ? 'inventory.quarantine' : from === 'QUARANTINE' ? 'inventory.release-quarantine' : 'inventory.recall';

async function transferStatus(input, suppliedClient = null) {
  const idempotencyKey = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!idempotencyKey) throw new InventoryError('INVALID_IDEMPOTENCY_KEY', 'A status transfer idempotencyKey is required', 400);
  const from = String(input?.fromStatus || '').toUpperCase();
  const to = String(input?.toStatus || '').toUpperCase();
  if (!ALLOWED.has(`${from}:${to}`)) throw new InventoryError('INVALID_STATUS_TRANSITION', `Unsupported inventory status transition ${from} -> ${to}`, 409);
  if (!input.reason?.trim()) throw new InventoryError('REASON_REQUIRED', 'A reason is required', 400);
  const permission = permissionFor(from, to);
  if (!hasPermission(input.actor, permission)) throw new InventoryError('INVENTORY_PERMISSION_DENIED', `Permission required: ${permission}`, 403);
  const correlationId = input.correlationId || `status-transfer:${idempotencyKey}`;
  const operation = to === 'QUARANTINE' ? 'QUARANTINE' : from === 'QUARANTINE' ? 'RELEASE' : 'RECALL';
  return withTransaction(async (client) => {
    const common = { inventoryItemId: input.inventoryItemId, instituteId: input.instituteId, warehouseId: input.warehouseId,
      quantity: input.quantity, batchNumber: input.batchNumber, lotNumber: input.lotNumber, serialNumber: input.serialNumber,
      expiryDate: input.expiryDate, sourceDocumentType: input.sourceDocumentType || 'inventory_status_transfer',
      sourceDocumentId: input.sourceDocumentId, sourceDocumentLineId: input.sourceDocumentLineId, reason: input.reason.trim(),
      actor: input.actor, correlationId, metadata: { movementGroup: correlationId, statusTransfer: { from, to }, statusTransferOperation: operation } };
    const debit = await postStatusTransferMovement({ ...common, movementType: 'NEGATIVE_ADJUSTMENT', stockStatus: from, idempotencyKey: `${idempotencyKey}:debit` }, operation, client);
    const credits = [];
    for (const allocation of debit.allocations) {
      credits.push(await postStatusTransferMovement({ ...common, movementType: 'POSITIVE_ADJUSTMENT', stockStatus: to,
        quantity: Math.abs(Number(allocation.quantity)), batchNumber: allocation.batch_number,
        lotNumber: allocation.lot_number, serialNumber: allocation.serial_number, expiryDate: allocation.expiry_date,
        idempotencyKey: `${idempotencyKey}:credit:${allocation.allocation_sequence}`,
        metadata: { ...common.metadata, debitMovementId: debit.movement.id, debitAllocationId: allocation.id } }, operation, client));
    }
    return { debit, credits, correlationId };
  }, { client: suppliedClient, pool });
}

module.exports = { transferStatus, quarantine: (input, client) => transferStatus({ ...input, fromStatus: 'AVAILABLE', toStatus: 'QUARANTINE' }, client), releaseQuarantine: (input, client) => transferStatus({ ...input, fromStatus: 'QUARANTINE', toStatus: 'AVAILABLE' }, client) };