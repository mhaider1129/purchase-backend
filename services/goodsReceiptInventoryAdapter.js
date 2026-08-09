'use strict';

const { postMovements } = require('./inventoryPostingService');

function buildReceiptCommand(receipt, line, context) {
  // Persisted receipt semantics: received_quantity is gross; damage and shortage are deducted once.
  // accepted_quantity, when supplied by an internal normalized caller, is already final.
  const accepted = line.accepted_quantity != null
    ? Number(line.accepted_quantity)
    : Number(line.received_quantity ?? 0) - Number(line.rejected_quantity ?? line.damaged_quantity ?? 0) - Number(line.short_quantity ?? 0);
  if (!(accepted > 0)) return null;
  return {
    movementType: 'GOODS_RECEIPT', inventoryItemId: line.stock_item_id,
    instituteId: context.instituteId, warehouseId: context.warehouseId, quantity: accepted,
    baseUom: line.base_uom || line.unit, sourceQuantity: accepted, sourceUom: line.source_uom || line.unit,
    conversionFactor: line.conversion_factor || 1, batchNumber: line.batch_number || null,
    lotNumber: line.lot_number || null, serialNumber: line.serial_number || null,
    expiryDate: line.expiry_date || null, stockStatus: line.quarantined ? 'QUARANTINE' : 'AVAILABLE',
    sourceDocumentType: 'goods_receipt', sourceDocumentId: receipt.id,
    sourceDocumentLineId: line.id, actor: context.actor,
    idempotencyKey: `goods-receipt:${receipt.id}:line:${line.id}:accepted:${accepted}`,
    correlationId: context.correlationId, metadata: { receiptNumber: receipt.receipt_number, purchaseOrderId: receipt.purchase_order_id || null },
  };
}

async function postAcceptedReceiptLines(receipt, lines, context, suppliedClient = null) {
  const commands = lines.map((line) => buildReceiptCommand(receipt, line, context)).filter(Boolean);
  return commands.length ? postMovements(commands, suppliedClient) : [];
}

module.exports = { buildReceiptCommand, postAcceptedReceiptLines };