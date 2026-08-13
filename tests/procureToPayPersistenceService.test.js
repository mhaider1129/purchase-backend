const { insertGoodsReceipt, insertSupplierInvoice } = require('../services/procureToPayPersistenceService');

describe('procureToPayPersistenceService compatibility boundary', () => {
  test.each([
    ['receipt', insertGoodsReceipt, 'goodsReceiptService'],
    ['invoice', insertSupplierInvoice, 'supplierInvoiceService'],
  ])('legacy %s writer fails closed', async (_name, writer, canonicalService) => {
    const client = { query: jest.fn() };
    await expect(writer(client, {})).rejects.toMatchObject({ statusCode: 410 });
    await expect(writer(client, {})).rejects.toThrow(canonicalService);
    expect(client.query).not.toHaveBeenCalled();
  });
});