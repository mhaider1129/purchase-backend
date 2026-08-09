
'use strict';

const InventoryRepository = require('../repositories/inventoryRepository');
const { authorizeInventoryMovement } = require('../policies/inventoryPolicy');
const { validateInventoryMovement } = require('../validators/inventoryMovementValidator');
const { INVENTORY_MOVEMENT_TYPES } = require('../domain/inventoryMovementTypes');
const { buildReceiptCommand } = require('../services/goodsReceiptInventoryAdapter');
const { buildReversalCommand } = require('../services/inventoryReversalService');
const fs = require('fs');
const path = require('path');

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

  test('receipt quantities are calculated exactly once for accepted, damaged, short, partial, rejected and quarantine cases', () => {
    const context = { instituteId: 1, warehouseId: 2, actor: { id: 3 } };
    expect(buildReceiptCommand({ id: 1 }, { id: 1, stock_item_id: 4, accepted_quantity: 7, damaged_quantity: 2, short_quantity: 1 }, context).quantity).toBe(7);
    expect(buildReceiptCommand({ id: 1 }, { id: 2, stock_item_id: 4, received_quantity: 10, damaged_quantity: 2, short_quantity: 1 }, context).quantity).toBe(7);
    expect(buildReceiptCommand({ id: 1 }, { id: 3, received_quantity: 2, damaged_quantity: 2 }, context)).toBeNull();
    expect(buildReceiptCommand({ id: 1 }, { id: 4, received_quantity: 5, short_quantity: 5 }, context)).toBeNull();
    expect(buildReceiptCommand({ id: 1 }, { id: 5, stock_item_id: 4, accepted_quantity: 1, quarantined: true }, context).stockStatus).toBe('QUARANTINE');
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
    expect(sql).toContain('(warehouse_id, stock_item_id, stock_status, batch_number, lot_number, serial_number, expiry_date) NULLS NOT DISTINCT');
    expect(sql).toContain('GROUP BY stock_item_id, serial_number');
    expect(sql).toContain('ux_available_serial_location ON warehouse_stock_levels(stock_item_id, serial_number)');
    expect(sql).toContain('array_agg(id ORDER BY id) AS balance_ids');
  });
});