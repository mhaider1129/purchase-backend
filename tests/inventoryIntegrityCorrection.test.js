'use strict';

const InventoryRepository = require('../repositories/inventoryRepository');
const { authorizeInventoryMovement } = require('../policies/inventoryPolicy');
const { validateInventoryMovement } = require('../validators/inventoryMovementValidator');
const { INVENTORY_MOVEMENT_TYPES } = require('../domain/inventoryMovementTypes');
const { buildReceiptCommand } = require('../services/goodsReceiptInventoryAdapter');
const { buildReversalCommand } = require('../services/inventoryReversalService');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

describe('Phase 3 inventory integrity correction', () => {
  test('repository maps canonical inventoryItemId to stock_item_id', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new InventoryRepository(client).lockExactInventoryBalance({
      warehouseId: 3, inventoryItemId: 17, stockStatus: 'AVAILABLE',
      batchNumber: null, lotNumber: null, serialNumber: null, expiryDate: null,
    });
    expect(client.query.mock.calls[0][1]).toEqual([3, 17, 'AVAILABLE', null, null, null, null]);
    expect(client.query.mock.calls[0][0]).toContain('batch_number IS NOT DISTINCT FROM');
    expect(client.query.mock.calls[0][0]).toContain('expiry_date IS NOT DISTINCT FROM');
  });

  test('unbatched exact inbound cannot match a batched row and expiry is identity', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repo = new InventoryRepository(client);
    await repo.lockExactInventoryBalance({ warehouseId: 1, inventoryItemId: 2, stockStatus: 'AVAILABLE', expiryDate: '2028-01-01' });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).not.toContain('$4::text IS NULL OR');
    expect(params).toEqual([1, 2, 'AVAILABLE', null, null, null, '2028-01-01']);
  });

  test('different batches use different exact identities and plain inserts never use pair conflict', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 10 }] }) };
    const repo = new InventoryRepository(client);
    await repo.lockExactInventoryBalance({ warehouseId: 1, inventoryItemId: 2,
      stockStatus: 'AVAILABLE', batchNumber: 'Batch A' });
    await repo.lockExactInventoryBalance({ warehouseId: 1, inventoryItemId: 2,
      stockStatus: 'AVAILABLE', batchNumber: 'Batch B' });
    expect(client.query.mock.calls[0][1][3]).toBe('Batch A');
    expect(client.query.mock.calls[1][1][3]).toBe('Batch B');
    await repo.createInventoryBalance({ warehouseId: 1, inventoryItemId: 2,
      actor: { id: 3 }, stockStatus: 'AVAILABLE', batchNumber: 'Batch B' }, 'Gauze');
    expect(client.query.mock.calls[2][0]).not.toContain('ON CONFLICT (warehouse_id, stock_item_id)');
  });

  test('warehouse setup persists configuration policy without creating a zero balance', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new InventoryRepository(client).setupWarehouse(
      { id: 2, name: 'Gauze' }, { warehouse_id: 1 }, 9, 3,
    );
    const sql = client.query.mock.calls.map((call) => call[0]).join('\n');
    expect(sql).toContain('INSERT INTO warehouse_replenishment_policies');
    expect(sql).not.toContain('INSERT INTO warehouse_stock_levels');
  });

  test('outbound allocation is FEFO and explicit batch restricts identity', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new InventoryRepository(client).lockEligibleOutboundBalances({
      warehouseId: 1, inventoryItemId: 2, stockStatus: 'AVAILABLE', batchNumber: 'B-2',
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('ORDER BY expiry_date ASC NULLS LAST, id');
    expect(sql).toContain('batch_number IS NOT DISTINCT FROM $4');
    expect(params[3]).toBe('B-2');
  });

  const actor = (extra = {}) => ({ permissions: ['inventory.issue'], ...extra });
  test('missing actor institute is denied unless cross-institute is explicit', () => {
    expect(() => authorizeInventoryMovement(actor({ warehouse_id: 9 }), INVENTORY_MOVEMENT_TYPES.ISSUE, { id: 9, institute_id: 4 })).toThrow(expect.objectContaining({ code: 'INSTITUTE_SCOPE_DENIED' }));
    expect(() => authorizeInventoryMovement(actor({ warehouse_id: 9, permissions: ['inventory.issue', 'inventory.cross-institute'] }), INVENTORY_MOVEMENT_TYPES.ISSUE, { id: 9, institute_id: 4 })).not.toThrow();
  });

  test('missing actor warehouse is denied unless cross-warehouse is explicit', () => {
    expect(() => authorizeInventoryMovement(actor({ institute_id: 4 }), INVENTORY_MOVEMENT_TYPES.ISSUE, { id: 9, institute_id: 4 })).toThrow(expect.objectContaining({ code: 'WAREHOUSE_SCOPE_DENIED' }));
    expect(() => authorizeInventoryMovement(actor({ institute_id: 4, permissions: ['inventory.issue', 'inventory.cross-warehouse'] }), INVENTORY_MOVEMENT_TYPES.ISSUE, { id: 9, institute_id: 4 })).not.toThrow();
  });

  test.each(['QUARANTINE', 'RELEASE_FROM_QUARANTINE', 'TRANSFER_DISPATCH', 'TRANSFER_RECEIPT'])('%s is rejected by generic Phase 3A posting', (movementType) => {
    expect(() => validateInventoryMovement({ movementType })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_MOVEMENT', statusCode: 501 }));
  });

  test('receipt quantities follow persisted gross minus damaged minus short semantics', () => {
    const context = { instituteId: 1, warehouseId: 2, actor: { id: 3 } };
    expect(buildReceiptCommand({ id: 1 }, { id: 1, stock_item_id: 4, accepted_quantity: 7, damaged_quantity: 2, short_quantity: 1 }, context).quantity).toBe(7);
    expect(buildReceiptCommand({ id: 1 }, { id: 2, stock_item_id: 4, received_quantity: 10, damaged_quantity: 2, short_quantity: 1 }, context).quantity).toBe(7);
    expect(buildReceiptCommand({ id: 1 }, { id: 3, received_quantity: 2, damaged_quantity: 2 }, context)).toBeNull();
    expect(buildReceiptCommand({ id: 1 }, { id: 4, received_quantity: 5, short_quantity: 5 }, context)).toBeNull();
    expect(buildReceiptCommand({ id: 1 }, { id: 5, stock_item_id: 4, accepted_quantity: 1, quarantined: true }, context).stockStatus).toBe('QUARANTINE');
  });

  test('allocation rows preserve signed quantity, tracking identity and deterministic sequence', async () => {
    const rows = [{ id: 101 }, { id: 102 }];
    const client = { query: jest.fn().mockImplementation(async () => ({ rows: [rows.shift()] })) };
    const allocations = await new InventoryRepository(client).insertInventoryAllocations(50, [
      { warehouseStockLevelId: 8, warehouseId: 2, inventoryItemId: 4, stockStatus: 'AVAILABLE',
        quantity: -5, batchNumber: 'A', lotNumber: 'L-A', serialNumber: null,
        expiryDate: '2027-09-01', baseUom: 'each', sequence: 1 },
      { warehouseStockLevelId: 9, warehouseId: 2, inventoryItemId: 4, stockStatus: 'AVAILABLE',
        quantity: -7, batchNumber: 'B', lotNumber: 'L-B', serialNumber: null,
        expiryDate: '2027-10-01', baseUom: 'each', sequence: 2 },
    ]);
    expect(allocations).toHaveLength(2);
    expect(client.query.mock.calls.map((call) => call[1].slice(0, 6))).toEqual([
      [50, 8, 2, 4, 'AVAILABLE', -5], [50, 9, 2, 4, 'AVAILABLE', -7],
    ]);
    expect(client.query.mock.calls[0][1].slice(6)).toEqual(['A', 'L-A', null, '2027-09-01', 'each', 1]);
  });

  test('movement query returns allocations while legacy movement remains readable', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 7, quantity: -2 }] })
      .mockResolvedValueOnce({ rows: [] }) };
    await expect(new InventoryRepository(client).loadMovementWithAllocations(7)).resolves.toEqual({
      movement: { id: 7, quantity: -2 }, allocations: [],
    });
  });

  test('reversal command targets exact original balance allocations', () => {
    const original = { id: 8, movement_type: 'ISSUE', stock_item_id: 3, institute_id: 1,
      warehouse_id: 2, quantity: -12, stock_status: 'AVAILABLE' };
    const command = buildReversalCommand(original, { reason: 'Correction', actor: { id: 1 },
      idempotencyKey: 'reverse:8', allocations: [
        { warehouse_stock_level_id: 21, quantity: -5 },
        { warehouse_stock_level_id: 22, quantity: -7 },
      ] });
    expect(command.allocationOverrides).toEqual([
      { warehouseStockLevelId: 21, quantity: 5 }, { warehouseStockLevelId: 22, quantity: 7 },
    ]);
  });

  test('reversal preserves original business context', () => {
    const command = buildReversalCommand({ id: 8, movement_type: 'ISSUE', stock_item_id: 3, institute_id: 1,
      warehouse_id: 2, quantity: -4, department_id: 6, destination_location: 'department:6',
      source_document_type: 'warehouse_issue', source_document_id: '44', source_document_line_id: '5', stock_status: 'AVAILABLE' },
    { reason: 'Correction', actor: { id: 1 }, idempotencyKey: 'reverse:8' });
    expect(command.metadata).toMatchObject({ originalMovementId: 8, originalDepartmentId: 6,
      originalDestination: 'department:6', originalSourceDocumentType: 'warehouse_issue',
      originalSourceDocumentId: '44', originalSourceDocumentLineId: '5' });
  });

  test('SQL uses canonical uniqueness and identical serial preflight identity', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/004_inventory_transaction_engine.sql'), 'utf8');
    expect(sql).not.toMatch(/^@@|^diff --git|^index [0-9a-f]|^--- |^\+\+\+ /m);
    expect(sql).toContain('(warehouse_id, stock_item_id, stock_status, batch_number, lot_number, serial_number, expiry_date) NULLS NOT DISTINCT');
    expect(sql).toContain('GROUP BY stock_item_id, serial_number');
    expect(sql).toContain('ux_available_serial_location ON warehouse_stock_levels(stock_item_id, serial_number)');
    expect(sql).toContain('array_agg(id ORDER BY id) AS balance_ids');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_transaction_allocations');
    expect(sql).toContain('prevent_inventory_allocation_mutation');
    expect(sql).toContain("metadata->>'allocationLedgerVersion' = '1'");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_wsl_warehouse_item');
    expect(sql).toContain("= ARRAY['warehouse_id','stock_item_id']::name[]");
    expect(sql).not.toContain('DROP CONSTRAINT IF EXISTS warehouse_stock_levels_warehouse_id_stock_item_id_key');
    expect(sql).toContain('array_agg(batch_id ORDER BY id) AS legacy_batch_ids');
  });

  test('goods receipt delegates once and contains no legacy balance or movement write', () => {
    const source = fs.readFileSync(path.join(__dirname, '../controllers/procureToPayController.js'), 'utf8');
    const receiptFunction = source.slice(source.indexOf('const createGoodsReceipt'), source.indexOf('const estimatedReceiptValue'));
    expect(receiptFunction.match(/postAcceptedReceiptLines\(/g)).toHaveLength(1);
    expect(receiptFunction).not.toContain('INSERT INTO warehouse_stock_levels');
    expect(receiptFunction).not.toContain('INSERT INTO warehouse_stock_movements');
    expect(receiptFunction).toContain('No stock item found');
  });

  test('manual SQL validator rejects a copied diff hunk with its exact line', () => {
    const fixture = path.join(__dirname, 'tmp-sql004-diff.sql');
    fs.writeFileSync(fixture, 'BEGIN;\n@@ -85,96 +86,116 @@ COMMIT;\n');
    try {
      const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/validateManualSql.js'), fixture], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('tmp-sql004-diff.sql:2: Git patch metadata');
    } finally {
      fs.unlinkSync(fixture);
    }
  });
});