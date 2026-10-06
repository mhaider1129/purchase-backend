const { ItemMasterFoundationService, pageOptions } = require('../services/itemMasterFoundationService');

describe('ItemMasterFoundationService', () => {
  test('initializes standard lists once, auditing new records and preserving existing references', async () => {
    const existing = new Set(['EA']);
    let id = 10;
    const client = { query: jest.fn(async (sql, values) => {
      if (!sql.startsWith('INSERT INTO item_uom') && !sql.startsWith('INSERT INTO item_categories')) return {};
      const key = values[0];
      if (existing.has(key)) return { rowCount: 0, rows: [] };
      existing.add(key);
      return { rowCount: 1, rows: [{ id: id++, is_active: true }] };
    }), release: jest.fn() };
    const service = new ItemMasterFoundationService({ connect: jest.fn(async () => client) });
    expect(await service.initializeReferences(9)).toEqual({ created: 26 });
    expect(await service.initializeReferences(9)).toEqual({ created: 0 });
    const auditCalls = client.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO item_master_audit_events'));
    expect(auditCalls).toHaveLength(26);
    expect(auditCalls.every(([, values]) => values[2] === 9)).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('DO UPDATE') || sql.startsWith('UPDATE'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  test('rolls reference initialization back if auditing fails', async () => {
    const client = { query: jest.fn(async sql => {
      if (sql.startsWith('INSERT INTO item_master_audit_events')) throw new Error('audit unavailable');
      return { rowCount: 1, rows: [{ id: 1 }] };
    }), release: jest.fn() };
    const service = new ItemMasterFoundationService({ connect: jest.fn(async () => client) });
    await expect(service.initializeReferences(9)).rejects.toThrow('audit unavailable');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('pages reference lists with an independent total and retains the array contract for older callers', async () => {
    const db = { query: jest.fn(async sql => sql.includes('COUNT(*)') ? { rows: [{ total: 51 }] } : { rows: [{ id: 3 }] }) };
    const service = new ItemMasterFoundationService(db);
    expect(await service.searchReferences('categories', { page: 2, page_size: 25 })).toEqual({ data: [{ id: 3 }], total: 51, page: 2, page_size: 25 });
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('OFFSET $4'), ['', '%%', 25, 25]);
    expect(await service.searchReferences('categories')).toEqual([{ id: 3 }]);
  });
  test('caps pagination and only allows known sort expressions', () => {
    expect(pageOptions({ page: '-2', page_size: '500', sort: 'id; DROP TABLE users', direction: 'desc' }))
      .toEqual({ page: 1, pageSize: 100, sort: 'generic_name', direction: 'DESC' });
  });

  test('blocks invalid lifecycle transitions inside a transaction', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, lifecycle_status: 'draft' }] })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    const service = new ItemMasterFoundationService({ connect: jest.fn().mockResolvedValue(client) });
    await expect(service.transitionGeneric(5, 'active', 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('requires an active generic item before creating a product', async () => {
    const client = { query: jest.fn(async sql => sql.includes('SELECT 1 FROM generic_items') ? { rowCount: 0, rows: [] } : {}), release: jest.fn() };
    const service = new ItemMasterFoundationService({ connect: jest.fn(async () => client) });
    await expect(service.createProduct({ generic_item_id: 7, manufacturer: 'Acme', manufacturer_id: 2, product_name: 'Pump Set', manufacturer_part_number: 'P-1', product_uom: 'EA', product_uom_id: 4 }, 3))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('requires an approved product before creating supplier commercial data', async () => {
    const client = { query: jest.fn(async sql => sql.includes('SELECT 1 FROM approved_products') ? { rowCount: 0, rows: [] } : {}), release: jest.fn() };
    const service = new ItemMasterFoundationService({ connect: jest.fn(async () => client) });
    await expect(service.createCatalog({ supplier_id: 2, approved_product_id: 8, supplier_item_code: 'S-8', purchasing_uom: 'BOX', purchasing_uom_id: 4 }, 3))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
