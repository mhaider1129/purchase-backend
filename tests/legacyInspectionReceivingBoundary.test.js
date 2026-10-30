// Canonical disposition application remains the only release path. Stub the
// authorized task reader and schema check, exercise real quantity/posting logic.
jest.mock('../services/technicalReviewProfiles', () => ({ requireSchema: jest.fn(), history: jest.fn() }));
jest.mock('../services/deliveryInspectionService', () => ({
  ...jest.requireActual('../services/deliveryInspectionService'),
  createDeliveryInspectionService: jest.fn(), notify: jest.fn(),
}));
const { applyTechnicalDisposition } = require('../services/goodsReceiptService');
const delivery = require('../services/deliveryInspectionService');
const actor = { id: 8, institute_id: 7, hasPermission: p => p === 'procure-to-pay.receipts.manage' };
function harness(status = 'DECIDED') {
  const task = { status, id: 6, row_version: 1, purchase_order_id: 4, purchase_order_item_id: 5, receipt_item_id: 10, goods_receipt_id: 11, warehouse_id: 3, stock_status: 'QUARANTINE', remaining_quantity: '10', history: [], assignments: [], pending_disposition: { history_id: 12, accepted_quantity: '4', rejected_quantity: '2' } };
  delivery.createDeliveryInspectionService.mockReturnValue({ get: jest.fn().mockResolvedValue(task) });
  const tx = {
    client: { query: jest.fn().mockResolvedValue({ rows: [] }) },
    lockPurchaseOrder: jest.fn().mockResolvedValue({ id: 4, status: 'PO_ISSUED' }),
    lockPurchaseOrderLines: jest.fn().mockResolvedValue([{ id: 5, line_type: 'INVENTORY', base_uom_id: 1 }]),
    loadReceiptWithLines: jest.fn().mockResolvedValue({ id: 11 }),
    loadWarehouseScope: jest.fn().mockResolvedValue({ id: 3, institute_id: 7 }),
    resolveReceiptStockItem: jest.fn().mockResolvedValue({ id: 21, inventory_uom_id: 1 }),
    applyTechnicalReceiptQuantities: jest.fn(), synchronizePurchaseOrderLineReceivedQuantity: jest.fn(),
    calculatePurchaseOrderReceiptTotals: jest.fn().mockResolvedValue({ received_quantity: '4', ordered_quantity: '10' }),
    markPurchaseOrderPartiallyReceived: jest.fn(), markPurchaseOrderDelivered: jest.fn(),
  };
  const inventory = { postAcceptedReceiptLines: jest.fn().mockResolvedValue([]) };
  const run = () => applyTechnicalDisposition({ repository: { withTransaction: work => work(tx) }, taskId: 6, input: { row_version: 1, disposition_id: 12 }, actor, inventory });
  return { tx, inventory, task, run };
}
test('a pending required GR inspection cannot be applied even after legacy form acceptance', async () => {
  const h = harness('PENDING');
  await expect(h.run()).rejects.toMatchObject({ statusCode: 409 });
  expect(h.inventory.postAcceptedReceiptLines).not.toHaveBeenCalled();
  expect(h.tx.applyTechnicalReceiptQuantities).not.toHaveBeenCalled();
});
test('partial acceptance releases only authorized quantity, preserves quarantine and remaining hold', async () => {
  const h = harness(); await h.run();
  expect(h.inventory.postAcceptedReceiptLines).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ accepted_quantity: '4', quarantined: true })], expect.objectContaining({ dispositionId: 12 }), h.tx.client);
  expect(h.tx.applyTechnicalReceiptQuantities).toHaveBeenCalledWith(10, '4', '2');
  expect(h.tx.markPurchaseOrderDelivered).not.toHaveBeenCalled();
  expect(h.tx.markPurchaseOrderPartiallyReceived).toHaveBeenCalledWith(4);
  expect(h.tx.client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE delivery_inspection_tasks'), [6, 'ON_HOLD']);
});
test('release permission is still mandatory', async () => {
  await expect(applyTechnicalDisposition({ actor: { id: 2 }, taskId: 6 })).rejects.toMatchObject({ statusCode: 403 });
});
test('foreign receiving warehouse cannot release inventory', async () => {
  const h = harness(); h.tx.loadWarehouseScope.mockResolvedValue({ id: 3, institute_id: 99 });
  await expect(h.run()).rejects.toMatchObject({ statusCode: 403 });
  expect(h.inventory.postAcceptedReceiptLines).not.toHaveBeenCalled();
});
