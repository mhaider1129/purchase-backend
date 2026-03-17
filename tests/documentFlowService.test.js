const { linkDocuments } = require('../services/documentFlowService');

describe('documentFlowService', () => {
  it('inserts a document flow link with normalized ids and metadata', async () => {
    const query = jest.fn().mockResolvedValue({});
    const client = { query };

    await linkDocuments(client, {
      requestId: 9,
      sourceType: 'PURCHASE_ORDER',
      sourceId: 101,
      targetType: 'GOODS_RECEIPT_PO',
      targetId: 202,
      metadata: { receipt_number: 'GR-1' },
      createdBy: 7,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO document_flow_links'),
      [9, 'PURCHASE_ORDER', '101', 'GOODS_RECEIPT_PO', '202', JSON.stringify({ receipt_number: 'GR-1' }), 7]
    );
  });
});