'use strict';

const { createConnectedP2PRepository } = require('../repositories/connectedP2PRepository');

const mockClient = () => {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, values) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      return { rows: [{ amount: '0', quantity: '0' }], rowCount: 1 };
    }),
  };
};

describe('connected P2P repository checked-in schema contract', () => {
  test('receipt operations execute against goods_receipt_items and its real quantity columns', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.loadCumulativeReceipts(4);
    await repository.insertGoodsReceiptLine({ goods_receipt_id: 1, purchase_order_item_id: 4, requested_item_id: 2, item_name: 'Gloves', ordered_quantity: '10', accepted_quantity: '4', unit_price: '2' });
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain('goods_receipt_items');
    expect(executed).toContain('received_quantity');
    expect(executed).not.toContain('goods_receipt_lines');
  });

  test('invoice operations execute against invoice_items only', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.insertSupplierInvoiceLine({ supplier_invoice_id: 1, purchase_order_item_id: 2, requested_item_id: 3, description: 'Service', quantity: '1', unit_price: '5', line_total: '5' });
    await repository.loadPriorValidInvoices(8, 9);
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain('invoice_items');
    expect(executed).not.toContain('supplier_invoice_items');
  });

  test('budget operations execute with stage/state and never legacy column names', async () => {
    const client = mockClient();
    const repository = createConnectedP2PRepository(client);
    await repository.sumActiveEncumbrances(1);
    await repository.insertEncumbrance({ request_id: 2, budget_envelope_id: 1, purchase_order_id: 3, amount: '12.00', currency: 'USD', idempotency_key: 'po-release:3', actor_id: 4 });
    await repository.releaseCommitment(7);
    const executed = client.queries.map(({ sql }) => sql).join('\n');
    expect(executed).toContain("stage='encumbrance'");
    expect(executed).toContain("state='ACTIVE'");
    expect(executed).not.toMatch(/commitment_type|\bstatus\s*=\s*'ACTIVE'/);
  });
});