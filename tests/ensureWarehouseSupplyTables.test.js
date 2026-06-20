describe('ensureWarehouseSupplyTables', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('adds batch_id without requiring the inventory batch table to exist', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.doMock('../config/db', () => ({ query }));

    const { ensureWarehouseSupplyApprovalColumns } = require('../utils/ensureWarehouseSupplyTables');

    await ensureWarehouseSupplyApprovalColumns();

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS batch_id INTEGER');
    expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES warehouse_item_batches(id)');
  });
});