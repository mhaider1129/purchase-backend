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
     VALUES ($1, $2, CONCAT('GR-', $1::bigint, '-', EXTRACT(EPOCH FROM NOW())::bigint), $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7)
     RETURNING *`,
    [requestId, purchaseOrderId, warehouseLocation, userId, receivedAt, notes, discrepancyNotes]
  );

  const insertedItems = [];

  for (const item of items) {
    if (!item.item_name || Number(item.received_quantity) <= 0) {
      throw createHttpError(400, 'Each receipt item requires item_name and positive received_quantity');
    }

    let identity = {
      generic_item_id: item.generic_item_id || null,
      approved_product_id: item.approved_product_id || null,
      supplier_catalog_item_id: item.supplier_catalog_item_id || null,
    };
    if (item.requested_item_id && !identity.generic_item_id) {
      const linked = await client.query(
        'SELECT generic_item_id, COALESCE(mandatory_product_id, preferred_product_id) AS approved_product_id FROM requested_items WHERE id=$1 AND request_id=$2',
        [item.requested_item_id, requestId]
      );
      identity = { ...identity, ...(linked.rows[0] || {}) };
    }
    const insertedItem = await client.query(
      `INSERT INTO goods_receipt_items (
        goods_receipt_id, requested_item_id, item_name, ordered_quantity, received_quantity,
        damaged_quantity, short_quantity, unit_price, line_notes,
        generic_item_id, approved_product_id, supplier_catalog_item_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        identity.generic_item_id,
        identity.approved_product_id,
        identity.supplier_catalog_item_id,
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
  supplierId = null,
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
  if (!supplierId || !supplier || !invoiceNumber || !invoiceDate || Number(totalAmount) <= 0) {
    throw createHttpError(400, 'supplier_id, invoice_number, invoice_date, and total_amount are required');
  }

  const invoiceRes = await client.query(
    `INSERT INTO supplier_invoices (
      request_id, supplier, supplier_id, invoice_number, invoice_date, subtotal_amount, tax_amount,
      extra_charges, total_amount, currency, purchase_order_id, po_equivalent_number, receipt_id,
      attachment_metadata, submitted_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [
      requestId,
      supplier,
      supplierId,
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