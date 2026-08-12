'use strict';

const { createGoodsReceipt } = require('../services/goodsReceiptService');

function harness({ status = 'PO_ISSUED', quantity = 100, lineType = 'NON_INVENTORY', inventoryFails = false } = {}) {
  const receipts = new Map(); let cumulative = 0; let receiptId = 0; let poStatus = status;
  const audit = { writeAuditEvent: jest.fn().mockResolvedValue({}) };
  const outbox = { enqueueNotification: jest.fn().mockResolvedValue({ created: true }) };
  const inventory = { postAcceptedReceiptLines: jest.fn(async () => { if (inventoryFails) throw new Error('inventory failed'); return [{ movement: { id: 9 } }]; }) };
  const tx = {
    client: { query: jest.fn() }, findReceiptByIdempotency: jest.fn(async (key) => receipts.get(key)?.receipt || null),
    loadReceiptWithLines: jest.fn(async (id) => [...receipts.values()].find((v) => v.receipt.id === id)?.receipt),
    lockPurchaseOrder: jest.fn(async () => ({ id: 4, request_id: 2, supplier_id: 8, status: poStatus })),
    lockPurchaseOrderLines: jest.fn(async (ids) => ids.map((id) => ({ id, purchase_order_id: 4, requested_item_id: 7, item_name: 'Gloves', quantity, received_quantity: cumulative, unit_price: 2, line_type: lineType }))),
    loadCumulativeReceipts: jest.fn(async () => String(cumulative)),
    insertGoodsReceipt: jest.fn(async (input) => ({ id: ++receiptId, ...input, receipt_number: `GR-${receiptId}` })),
    insertGoodsReceiptLine: jest.fn(async (line) => { cumulative += Number(line.received_quantity); return { id: receiptId * 10, ...line }; }),
    synchronizePurchaseOrderLineReceivedQuantity: jest.fn(async () => ({})),
    calculatePurchaseOrderReceiptTotals: jest.fn(async () => ({ ordered_quantity: String(quantity), received_quantity: String(cumulative) })),
    markPurchaseOrderPartiallyReceived: jest.fn(async () => ({ id: 4, status: (poStatus = 'PO_PARTIAL') })),
    markPurchaseOrderDelivered: jest.fn(async () => ({ id: 4, status: (poStatus = 'PO_DELIVERED') })),
    loadWarehouseScope: jest.fn(async () => ({ id: 3, institute_id: 5 })),
    resolveReceiptStockItem: jest.fn(async () => ({ id: 11 })),
  };
  const repository = { withTransaction: jest.fn(async (work) => { const before = cumulative; try { const result = await work(tx); receipts.set(result.receipt.idempotency_key, { receipt: result.receipt }); return result; } catch (error) { cumulative = before; throw error; } }) };
  const receive = (key, received, extra = {}) => createGoodsReceipt({ repository, purchaseOrderId: 4, idempotencyKey: key,
    lines: [{ purchase_order_item_id: 1, received_quantity: received, ...extra }], actor: { id: 1, institute_id: 5 }, requestId: 2, auditService: audit, outbox, inventory });
  return { receive, tx, audit, outbox, inventory, get cumulative() { return cumulative; }, get status() { return poStatus; } };
}

describe('canonical goods receipt transaction', () => {
  test.each(['PO_DRAFT', 'PO_APPROVED', 'PO_CANCELLED'])('rejects %s', async (status) => {
    await expect(harness({ status }).receive('key', 1)).rejects.toMatchObject({ code: 'PO_NOT_RECEIVABLE' });
  });

  test('supports 40 + 30 + 30, transitions partial then delivered, and rejects over-receipt', async () => {
    const h = harness();
    await h.receive('one', 40); expect(h.status).toBe('PO_PARTIAL');
    await h.receive('two', 30); expect(h.status).toBe('PO_PARTIAL');
    await h.receive('three', 30); expect(h.status).toBe('PO_DELIVERED');
    await expect(h.receive('four', 1)).rejects.toMatchObject({ code: 'PO_NOT_RECEIVABLE' });
    expect(h.cumulative).toBe(100);
  });

  test('identical idempotent retry has no duplicate audit, outbox, projection, or inventory', async () => {
    const h = harness({ lineType: 'INVENTORY' });
    const first = await h.receive('same', 40, { warehouse_id: 3, batch_number: 'B1', expiry_date: '2027-01-01' });
    const retry = await h.receive('same', 40, { warehouse_id: 3, batch_number: 'B1', expiry_date: '2027-01-01' });
    expect(retry).toMatchObject({ idempotent: true, receipt: { id: first.receipt.id } });
    expect(h.inventory.postAcceptedReceiptLines).toHaveBeenCalledTimes(1);
    expect(h.audit.writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(h.outbox.enqueueNotification).toHaveBeenCalledTimes(2);
    expect(h.tx.synchronizePurchaseOrderLineReceivedQuantity).toHaveBeenCalledTimes(1);
  });

  test('changed quantity with the same key conflicts', async () => {
    const h = harness(); await h.receive('same', 40);
    await expect(h.receive('same', 41)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('inventory metadata reaches the adapter and inventory failure rolls back receipt state', async () => {
    const h = harness({ lineType: 'INVENTORY', inventoryFails: true });
    await expect(h.receive('inv', 10, { warehouse_id: 3, batch_number: 'B7', lot_number: 'L2', expiry_date: '2027-01-01', stock_status: 'QUARANTINE' })).rejects.toThrow('inventory failed');
    expect(h.cumulative).toBe(0);
    const line = h.inventory.postAcceptedReceiptLines.mock.calls[0][1][0];
    expect(line).toMatchObject({ batch_number: 'B7', lot_number: 'L2', expiry_date: '2027-01-01', quarantined: true, accepted_quantity: 10 });
    expect(h.audit.writeAuditEvent).not.toHaveBeenCalled();
  });

  test.each(['NON_INVENTORY', 'SERVICE'])('%s receipt creates no stock', async (lineType) => {
    const h = harness({ lineType }); await h.receive(`key-${lineType}`, 10, { warehouse_id: 3 });
    expect(h.inventory.postAcceptedReceiptLines).not.toHaveBeenCalled();
  });

  test('damaged and short quantities are excluded from projection input', async () => {
    const h = harness(); await h.receive('damage', 10, { damaged_quantity: 2, short_quantity: 1 });
    expect(h.tx.insertGoodsReceiptLine).toHaveBeenCalledWith(expect.objectContaining({ received_quantity: 10, damaged_quantity: 2, short_quantity: 1, accepted_quantity: 7 }));
  });
});