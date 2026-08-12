'use strict';

const crypto = require('crypto');
const createHttpError = require('../utils/httpError');
const inventoryAdapter = require('./goodsReceiptInventoryAdapter');
const sharedAuditService = require('./auditService');
const notificationOutbox = require('./notificationOutboxService');

const RECEIVABLE_STATUSES = new Set(['PO_ISSUED', 'PO_PARTIAL']);
const SCALE = 10000n;

function decimal(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw createHttpError(400, `${field} must be a positive decimal with at most four decimal places`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

function fingerprint(purchaseOrderId, lines) {
  const canonicalQuantity = (value, field) => decimal(value, field).toString();
  const normalized = lines.map((line) => ({
    purchase_order_item_id: Number(line.purchase_order_item_id),
    received_quantity: canonicalQuantity(line.received_quantity, 'received_quantity'),
    damaged_quantity: canonicalQuantity(line.damaged_quantity || 0, 'damaged_quantity'),
    short_quantity: canonicalQuantity(line.short_quantity || 0, 'short_quantity'), batch_number: line.batch_number || null,
    lot_number: line.lot_number || null, serial_number: line.serial_number || null,
    expiry_date: line.expiry_date || null, warehouse_id: line.warehouse_id == null ? null : Number(line.warehouse_id),
    stock_status: line.stock_status || 'AVAILABLE',
  })).sort((a, b) => a.purchase_order_item_id - b.purchase_order_item_id);
  return crypto.createHash('sha256').update(JSON.stringify({ purchase_order_id: Number(purchaseOrderId), lines: normalized })).digest('hex');
}

async function createGoodsReceipt({ repository, purchaseOrderId, idempotencyKey, lines, receivedAt = null,
  actor, auditService = sharedAuditService, outbox = notificationOutbox, inventory = inventoryAdapter,
  requestId = null, warehouseLocation = null, notes = null, discrepancyNotes = null, correlationId = null }) {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw createHttpError(400, 'A non-empty idempotency key is required');
  if (!Number.isInteger(Number(purchaseOrderId)) || Number(purchaseOrderId) <= 0) throw createHttpError(400, 'A valid purchase_order_id is required');
  if (!Array.isArray(lines) || !lines.length) throw createHttpError(400, 'At least one receipt line is required');
  const payloadFingerprint = fingerprint(purchaseOrderId, lines);

  return repository.withTransaction(async (tx) => {
    const prior = await tx.findReceiptByIdempotency(key);
    if (prior) {
      if (prior.payload_fingerprint !== payloadFingerprint) throw Object.assign(createHttpError(409, 'Idempotency key was already used with a different receipt payload'), { code: 'IDEMPOTENCY_CONFLICT' });
      return { receipt: await tx.loadReceiptWithLines(prior.id), idempotent: true };
    }
    const po = await tx.lockPurchaseOrder(Number(purchaseOrderId));
    if (!po) throw createHttpError(404, 'Purchase order not found');
    if (!RECEIVABLE_STATUSES.has(po.status)) throw Object.assign(createHttpError(409, `Purchase order status ${po.status} cannot receive goods`), { code: 'PO_NOT_RECEIVABLE' });
    if (requestId != null && Number(po.request_id) !== Number(requestId)) throw createHttpError(400, 'purchase_order_id does not belong to the provided request');

    const ids = lines.map((line) => Number(line.purchase_order_item_id));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw createHttpError(400, 'Each line requires a unique purchase_order_item_id');
    const locked = await tx.lockPurchaseOrderLines([...ids].sort((a, b) => a - b));
    const byId = new Map(locked.map((line) => [Number(line.id), line]));
    if (locked.length !== ids.length || locked.some((line) => Number(line.purchase_order_id) !== Number(po.id))) throw createHttpError(400, 'Every receipt line must belong to the purchase order');

    const prepared = [];
    for (const input of lines) {
      const poLine = byId.get(Number(input.purchase_order_item_id));
      const gross = decimal(input.received_quantity, 'received_quantity');
      const damaged = decimal(input.damaged_quantity || 0, 'damaged_quantity');
      const short = decimal(input.short_quantity || 0, 'short_quantity');
      const accepted = gross - damaged - short;
      if (gross <= 0n || accepted < 0n) throw createHttpError(400, 'Received quantity must be positive and discrepancies cannot exceed it');
      const already = decimal(await tx.loadCumulativeReceipts(poLine.id), 'already_received');
      const ordered = decimal(poLine.quantity, 'ordered_quantity');
      if (gross > ordered - already) throw Object.assign(createHttpError(409, `Receipt exceeds remaining quantity for PO line ${poLine.id}`), { code: 'OVER_RECEIPT' });
      prepared.push({ ...input, ...poLine, purchase_order_item_id: poLine.id, received_quantity: input.received_quantity,
        damaged_quantity: input.damaged_quantity || 0, short_quantity: input.short_quantity || 0,
        accepted_quantity: Number(accepted) / Number(SCALE), ordered_quantity: poLine.quantity,
        item_name: poLine.item_name || input.item_name, requested_item_id: poLine.requested_item_id });
    }

    const receipt = await tx.insertGoodsReceipt({ purchase_order_id: po.id, request_id: po.request_id,
      idempotency_key: key, payload_fingerprint: payloadFingerprint, received_at: receivedAt,
      received_by: actor?.id, warehouse_location: warehouseLocation, notes, discrepancy_notes: discrepancyNotes });
    receipt.items = [];
    const inventoryMovements = [];
    for (const line of prepared) {
      const saved = await tx.insertGoodsReceiptLine({ ...line, goods_receipt_id: receipt.id });
      receipt.items.push(saved);
      await tx.synchronizePurchaseOrderLineReceivedQuantity(line.purchase_order_item_id);
      if (line.line_type === 'INVENTORY' && line.accepted_quantity > 0) {
        const stockItem = line.stock_item_id ? { id: line.stock_item_id } : await tx.resolveReceiptStockItem(line.requested_item_id);
        if (!stockItem) throw createHttpError(409, `Inventory line ${line.id} is not mapped to a canonical stock item`);
        const warehouse = await tx.loadWarehouseScope(Number(line.warehouse_id));
        if (!warehouse?.institute_id) throw createHttpError(400, `Inventory line ${line.id} requires a valid warehouse_id`);
        if (actor?.institute_id && Number(actor.institute_id) !== Number(warehouse.institute_id)) throw createHttpError(403, 'Receipt warehouse is outside the actor institute scope');
        const posted = await inventory.postAcceptedReceiptLines(receipt, [{ ...line, ...saved, stock_item_id: stockItem.id, accepted_quantity: line.accepted_quantity,
          quarantined: line.stock_status === 'QUARANTINE' }], { instituteId: warehouse.institute_id,
          warehouseId: warehouse.id, actor, correlationId }, tx.client);
        inventoryMovements.push(...posted);
      }
    }
    const totals = await tx.calculatePurchaseOrderReceiptTotals(po.id);
    const delivered = decimal(totals.received_quantity, 'received total') >= decimal(totals.ordered_quantity, 'ordered total');
    const updatedPo = delivered ? await tx.markPurchaseOrderDelivered(po.id) : await tx.markPurchaseOrderPartiallyReceived(po.id);
    const movementIds = inventoryMovements.map((entry) => entry.movement?.id).filter(Boolean);
    await auditService.writeAuditEvent({ entityType: 'goods_receipt', entityId: receipt.id, action: 'GOODS_RECEIPT_POSTED',
      actorUserId: actor?.id, instituteId: actor?.institute_id, requestId: po.request_id, correlationId,
      metadata: { receiptId: receipt.id, purchaseOrderId: po.id, supplierId: po.supplier_id, lineCount: receipt.items.length,
        receivedQuantities: receipt.items.map((line) => line.received_quantity), inventoryMovementIds: movementIds }, client: tx.client });
    await outbox.enqueueNotification(tx.client, { type: 'GOODS_RECEIPT_POSTED', entityType: 'goods_receipt', entityId: receipt.id,
      idempotencyKey: `goods-receipt:${receipt.id}:posted`, payload: { purchaseOrderId: po.id, status: updatedPo.status } });
    await outbox.enqueueNotification(tx.client, { type: updatedPo.status, entityType: 'purchase_order', entityId: po.id,
      idempotencyKey: `purchase-order:${po.id}:${updatedPo.status.toLowerCase()}:receipt:${receipt.id}`, payload: { receiptId: receipt.id } });
    return { receipt, purchaseOrder: updatedPo, inventoryMovements, idempotent: false };
  });
}

module.exports = { createGoodsReceipt, fingerprint, decimal, RECEIVABLE_STATUSES };