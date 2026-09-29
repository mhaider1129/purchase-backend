jest.mock('../config/db', () => ({ query: jest.fn() }));

describe('ensureWarehouseSupplyTables', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('upgrades a legacy warehouse item table with the purchase-item link', async () => {
    const { ensureWarehouseSupplyTables } = require('../utils/ensureWarehouseSupplyTables');
    const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

    await ensureWarehouseSupplyTables(client);

    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /ALTER TABLE public\.warehouse_supply_items ADD COLUMN IF NOT EXISTS requested_item_id INTEGER/i,
      ),
      expect.stringMatching(
        /CREATE INDEX IF NOT EXISTS idx_wsi_requested_item_id ON public\.warehouse_supply_items\(requested_item_id\)/i,
      ),
    ]));
  });
});