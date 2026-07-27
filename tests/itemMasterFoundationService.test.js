const { ItemMasterFoundationService, pageOptions } = require('../services/itemMasterFoundationService');

describe('ItemMasterFoundationService', () => {
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
    const service = new ItemMasterFoundationService({ query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) });
    await expect(service.createProduct({ generic_item_id: 7, manufacturer: 'Acme', manufacturer_id: 2, product_name: 'Pump Set', manufacturer_part_number: 'P-1', product_uom: 'EA', product_uom_id: 4 }, 3))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('requires an approved product before creating supplier commercial data', async () => {
    const service = new ItemMasterFoundationService({ query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) });
    await expect(service.createCatalog({ supplier_id: 2, approved_product_id: 8, supplier_item_code: 'S-8', purchasing_uom: 'BOX' }, 3))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});