const { insertGoodsReceipt, insertSupplierInvoice } = require('../services/procureToPayPersistenceService');

describe('procureToPayPersistenceService validation', () => {
  test('insertGoodsReceipt rejects empty items', async () => {
    const client = { query: jest.fn() };
    await expect(insertGoodsReceipt(client, { requestId: 1, userId: 2, items: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('insertGoodsReceipt returns inserted receipt items', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 10, receipt_number: 'GR-1-1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 20,
            goods_receipt_id: 10,
            requested_item_id: 3,
            item_name: 'Syringe',
            received_quantity: 5,
            damaged_quantity: 1,
            short_quantity: 0,
          }],
        }),
    };

    const result = await insertGoodsReceipt(client, {
      requestId: 1,
      userId: 2,
      items: [{ requested_item_id: 3, item_name: 'Syringe', received_quantity: 5, damaged_quantity: 1 }],
    });

    expect(result.id).toBe(10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item_name).toBe('Syringe');
  });

  test('insertSupplierInvoice rejects missing required fields', async () => {
    const client = { query: jest.fn() };
    await expect(insertSupplierInvoice(client, {
      requestId: 1,
      userId: 2,
      supplier: '',
      invoiceNumber: '',
      invoiceDate: '',
      totalAmount: 0,
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});