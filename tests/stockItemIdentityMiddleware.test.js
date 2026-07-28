const requirePermission = require('../middleware/requirePermission');
const {
  validateAddToInventory,
  validateApplyMapping,
} = require('../middleware/stockItemIdentityValidation');

function invoke(middleware, req) {
  return new Promise(resolve => middleware(req, {}, resolve));
}

describe('stock item identity authorization', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const error = await invoke(requirePermission('inventory.add-from-master'), {});
    expect(error.statusCode).toBe(401);
  });

  test('rejects authenticated users without the permission', async () => {
    const error = await invoke(requirePermission('item-master.stock-map'), {
      user: { permissions: [] },
    });
    expect(error.statusCode).toBe(403);
  });

  test('uses centralized permission data without requiring hasPermission', async () => {
    const result = await invoke(requirePermission('item-master.stock-map'), {
      user: { permissions: ['item-master.stock-map'] },
    });
    expect(result).toBeUndefined();
  });
});

describe('stock item identity payload validation', () => {
  test('accepts a controlled normalized inventory payload', async () => {
    const result = await invoke(validateAddToInventory, {
      body: {
        generic_item_id: 1,
        inventory_uom_id: 2,
        minimum_stock: 0,
        maximum_stock: 10,
        batch_tracking: true,
        warehouse_assignments: [{ warehouse_id: 3 }],
      },
    });
    expect(result).toBeUndefined();
  });

  test('rejects typed identity snapshots and malformed configuration', async () => {
    const error = await invoke(validateAddToInventory, {
      body: {
        generic_item_id: '1',
        inventory_uom_id: 2,
        manufacturer: 'caller supplied',
        consignment: 'false',
        minimum_stock: 11,
        maximum_stock: 10,
      },
    });
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual(
      expect.arrayContaining([
        { field: 'manufacturer', code: 'derived_identity_field' },
        { field: 'generic_item_id', code: 'positive_integer' },
        { field: 'consignment', code: 'boolean' },
      ])
    );
  });

  test('rejects malformed mapping IDs and oversized notes', async () => {
    const error = await invoke(validateApplyMapping, {
      body: { stock_item_id: 0, mapping_id: 1, generic_item_id: 2, notes: 'x'.repeat(2001) },
    });
    expect(error.statusCode).toBe(400);
    expect(error.details).toHaveLength(2);
  });
});