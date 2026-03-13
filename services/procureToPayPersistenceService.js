const createHttpError = require('../utils/httpError');

const insertGoodsReceipt = async (client, {
  requestId,
  userId,
  purchaseOrderId = null,
  warehouseLocation = null,
  receivedAt = null,
  notes = null,
  discrepancyNotes = null,
  items = [],
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError(400, 'At least one goods receipt item is required');
  }

  const receiptRes = await client.query(
    `INSERT INTO goods_receipts (request_id, purchase_order_id, receipt_number, warehouse_location, received_by, received_at, notes, discrepancy_notes)
     VALUES ($1, $2, CONCAT('GR-', $1, '-', EXTRACT(EPOCH FROM NOW())::bigint), $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7)
     RETURNING *`,
    [requestId, purchaseOrderId, warehouseLocation, userId, receivedAt, notes, discrepancyNotes]
  );

  const insertedItems = [];

  for (const item of items) {
    if (!item.item_name || Number(item.received_quantity) <= 0) {
      throw createHttpError(400, 'Each receipt item requires item_name and positive received_quantity');
    }

    const insertedItem = await client.query(
      `INSERT INTO goods_receipt_items (
        goods_receipt_id, requested_item_id, item_name, ordered_quantity, received_quantity,
        damaged_quantity, short_quantity, unit_price, line_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        receiptRes.rows[0].id,
        item.requested_item_id || null,
        item.item_name,
        item.ordered_quantity || null,
        item.received_quantity,
        item.damaged_quantity || 0,
        item.short_quantity || 0,
        item.unit_price || null,
        item.line_notes || null,
      ]
    );

    insertedItems.push(insertedItem.rows[0]);
  }

  return {
    ...receiptRes.rows[0],
    items: insertedItems,
  };
};

const insertSupplierInvoice = async (client, {
  requestId,
  userId,
  supplier,
  invoiceNumber,
  invoiceDate,
  subtotalAmount,
  taxAmount = 0,
  extraCharges = 0,
  totalAmount,
  currency = 'USD',
  purchaseOrderId = null,
  poEquivalentNumber = null,
  receiptId = null,
  attachmentMetadata = null,
  items = [],
}) => {
  if (!supplier || !invoiceNumber || !invoiceDate || Number(totalAmount) <= 0) {
    throw createHttpError(400, 'supplier, invoice_number, invoice_date, and total_amount are required');
  }

  const invoiceRes = await client.query(
    `INSERT INTO supplier_invoices (
      request_id, supplier, invoice_number, invoice_date, subtotal_amount, tax_amount,
      extra_charges, total_amount, currency, purchase_order_id, po_equivalent_number, receipt_id,
      attachment_metadata, submitted_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *`,
    [
      requestId,
      supplier,
      invoiceNumber,
      invoiceDate,
      subtotalAmount,
      taxAmount,
      extraCharges,
      totalAmount,
      currency,
      purchaseOrderId,
      poEquivalentNumber,
      receiptId,
      attachmentMetadata ? JSON.stringify(attachmentMetadata) : null,
      userId,
    ]
  );

  for (const [idx, item] of items.entries()) {
    if (!item.description || Number(item.quantity) <= 0 || Number(item.unit_price) < 0) {
      throw createHttpError(400, `Invalid invoice item at index ${idx}`);
    }

    await client.query(
      `INSERT INTO invoice_items (supplier_invoice_id, requested_item_id, description, quantity, unit_price, line_total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        invoiceRes.rows[0].id,
        item.requested_item_id || null,
        item.description,
        item.quantity,
        item.unit_price,
        item.line_total ?? Number(item.quantity) * Number(item.unit_price),
      ]
    );
  }

  return invoiceRes.rows[0];
};

module.exports = {
  insertGoodsReceipt,
  insertSupplierInvoice,
};