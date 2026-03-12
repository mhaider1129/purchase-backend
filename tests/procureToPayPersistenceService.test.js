const { insertGoodsReceipt, insertSupplierInvoice } = require('../services/procureToPayPersistenceService');

describe('procureToPayPersistenceService validation', () => {
  test('insertGoodsReceipt rejects empty items', async () => {
    const client = { query: jest.fn() };
    await expect(insertGoodsReceipt(client, { requestId: 1, userId: 2, items: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
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