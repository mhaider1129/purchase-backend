const StockItemMappingRepository = require('../repositories/stockItemMappingRepository');
const { StockItemMappingService } = require('../services/stockItemMappingService');

describe('stock item mapping queue', () => {
  test('starts from stock items so unmapped inventory remains visible', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await new StockItemMappingRepository(db).queue({}, { limit: 25, offset: 0 });

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('FROM stock_items si');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain("COALESCE(m.mapping_status, si.mapping_status, 'unmapped')");
    expect(values).toEqual([25, 0]);
  });

  test('passes workspace mapping status and source filters to the queue', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ stock_item_id: 7, total_count: 1 }] }) };

    const result = await new StockItemMappingService(db).list({
      mapping_status: 'unmapped', category: 'medical', identity_source: 'legacy_stock_item',
    });

    expect(result).toEqual({ data: [{ stock_item_id: 7 }], pagination: { page: 1, limit: 25, total: 1 } });
    expect(db.query.mock.calls[0][1]).toEqual(['unmapped', 'medical', 'legacy_stock_item', 25, 0]);
  });

  test('keeps stock item history scoped to mapping records', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await new StockItemMappingService(db).history(42);

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('FROM stock_item_master_mappings m');
    expect(sql).not.toContain('FROM stock_items si');
    expect(values).toEqual([42, 25, 0]);
  });
});