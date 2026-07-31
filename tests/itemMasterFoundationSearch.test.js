const { ItemMasterFoundationService } = require('../services/itemMasterFoundationService');

test('generic item search supports partial, case-insensitive catalog matches', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const service = new ItemMasterFoundationService(db);

  await service.searchGeneric({ q: 'master', status: 'active' });

  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain("CONCAT_WS(' ', item_code, generic_name, canonical_description, category, item_type) ILIKE $1");
  expect(params).toEqual(['%master%', 'active', 25, 0]);
});