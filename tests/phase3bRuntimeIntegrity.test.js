'use strict';

describe('Phase 3B runtime integrity behavior', () => {
  let balance;
  let movementId;

  const actor = (permissions) => ({
    id: 7, active: true, institute_id: 1, warehouse_id: 10, permissions,
  });

  beforeEach(() => {
    jest.resetModules();
    balance = { id: 30, warehouse_id: 10, stock_item_id: 20, stock_status: 'AVAILABLE', quantity: 100, reserved_quantity: 80 };
    movementId = 0;
    jest.doMock('../utils/withTransaction', () => (work, options) => work(options.client || {}));
    jest.doMock('../services/auditService', () => ({ writeAuditEvent: jest.fn() }));
    jest.doMock('../utils/recalculateAvailableQuantity', () => jest.fn());
    jest.doMock('../repositories/inventoryRepository', () => class FakeRepository {
      async lockPostingKeys() {}
      async findMovementWithAllocationsByIdempotencyKey() { return null; }
      async validateWarehouse() { return { id: 10, institute_id: 1 }; }
      async validateInventoryItem() { return { id: 20, name: 'Masks', unit: 'each' }; }
      async lockEligibleOutboundBalances() { return [balance]; }
      async lockExactInventoryBalance(command) { return command.stockStatus === balance.stock_status ? [balance] : []; }
      async lockInventoryBalanceById() { return balance; }
      async createInventoryBalance(command) {
        balance = { ...balance, id: 31, stock_status: command.stockStatus, quantity: 0, reserved_quantity: 0 };
        return balance;
      }
      async updateUnreservedInventoryBalance(id, delta) {
        if (balance.quantity + delta < balance.reserved_quantity) return null;
        balance = { ...balance, quantity: balance.quantity + delta }; return balance;
      }
      async updateInventoryBalance(id, delta) { balance = { ...balance, quantity: balance.quantity + delta }; return balance; }
      async insertInventoryMovement(command, quantity) { return { id: ++movementId, ...command, quantity, base_uom: 'each' }; }
      async insertInventoryAllocations(id, rows) { return rows.map((row, index) => ({ id: index + 1, allocation_sequence: index + 1, ...row, quantity: row.quantity })); }
    });
  });

  test('status service imports and quarantines without inventory.adjust', async () => {
    balance.reserved_quantity = 0;
    const { quarantine } = require('../services/inventoryStatusTransferService');
    const result = await quarantine({
      inventoryItemId: 20, instituteId: 1, warehouseId: 10, quantity: 5,
      sourceDocumentId: 9, reason: 'inspection', idempotencyKey: 'q-1',
      actor: actor(['inventory.quarantine']),
    }, {});
    expect(result.debit.movement.movementType).toBe('NEGATIVE_ADJUSTMENT');
    expect(result.credits).toHaveLength(1);
  });

  test('status transfer rejects unauthorized actor and generic posting cannot spoof authorization', async () => {
    const status = require('../services/inventoryStatusTransferService');
    await expect(status.quarantine({ reason: 'x', idempotencyKey: 'unauthorized-q', actor: actor([]) })).rejects.toMatchObject({ code: 'INVENTORY_PERMISSION_DENIED' });
    const { postMovement } = require('../services/inventoryPostingService');
    await expect(postMovement({
      movementType: 'NEGATIVE_ADJUSTMENT', inventoryItemId: 20, instituteId: 1, warehouseId: 10,
      quantity: 1, stockStatus: 'AVAILABLE', sourceDocumentType: 'fake', sourceDocumentId: 1,
      reason: 'spoof', idempotencyKey: 'spoof', metadata: { statusTransferOperation: 'QUARANTINE' },
      actor: actor(['inventory.quarantine']),
    }, {})).rejects.toMatchObject({ code: 'INVENTORY_PERMISSION_DENIED' });
  });

  test('generic outbound uses quantity minus reserved_quantity', async () => {
    const { postMovement } = require('../services/inventoryPostingService');
    const command = { movementType: 'ISSUE', inventoryItemId: 20, instituteId: 1, warehouseId: 10,
      quantity: 50, stockStatus: 'AVAILABLE', sourceDocumentType: 'request', sourceDocumentId: 1,
      idempotencyKey: 'issue-50', actor: actor(['inventory.issue']) };
    await expect(postMovement(command, {})).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 20 } });
    const posted = await postMovement({ ...command, quantity: 20, idempotencyKey: 'issue-20' }, {});
    expect(posted.allocations[0].quantity).toBe(-20);
    expect(balance).toMatchObject({ quantity: 80, reserved_quantity: 80 });
  });
});

describe('status transfer operation idempotency', () => {
  const permittedActor = { id: 7, active: true, institute_id: 1, warehouse_id: 10, permissions: ['inventory.quarantine'] };

  function harness() {
    const movements = new Map();
    const postedKeys = [];
    jest.resetModules();
    jest.doMock('../utils/withTransaction', () => (work) => work({}));
    jest.doMock('../services/inventoryPostingService', () => ({ postStatusTransferMovement: jest.fn(async (command) => {
      if (movements.has(command.idempotencyKey)) return { ...movements.get(command.idempotencyKey), idempotent: true };
      postedKeys.push(command.idempotencyKey);
      const result = command.idempotencyKey.endsWith(':debit')
        ? { movement: { id: postedKeys.length }, allocations: [{ id: 91, allocation_sequence: 1, quantity: -command.quantity }] }
        : { movement: { id: postedKeys.length }, allocations: [] };
      movements.set(command.idempotencyKey, result);
      return { ...result, idempotent: false };
    }) }));
    return { service: require('../services/inventoryStatusTransferService'), postedKeys };
  }

  const command = (key) => ({ inventoryItemId: 20, instituteId: 1, warehouseId: 10, quantity: 5,
    sourceDocumentId: 9, reason: 'inspection', idempotencyKey: key, actor: permittedActor });

  test('Q1 retry returns its deterministic debit/credit group while Q2 posts a new group', async () => {
    const h = harness();
    await h.service.quarantine(command('Q1'));
    await h.service.quarantine(command('Q1'));
    expect(h.postedKeys).toEqual(['Q1:debit', 'Q1:credit:1']);
    await h.service.quarantine(command('Q2'));
    expect(h.postedKeys).toEqual(['Q1:debit', 'Q1:credit:1', 'Q2:debit', 'Q2:credit:1']);
  });

  test('missing status-transfer operation key is rejected before a transaction starts', async () => {
    const h = harness();
    await expect(h.service.quarantine(command('  '))).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY', statusCode: 400 });
    expect(h.postedKeys).toHaveLength(0);
  });
});

describe('reservation issue transaction behavior', () => {
  const scopedActor = { id: 7, active: true, institute_id: 1, warehouse_id: 10,
    permissions: ['inventory.reserve', 'inventory.issue'] };

  function harness({ failPosting = false } = {}) {
    let state = { onHand: 100, reserved: 100, consumed: 0, released: 0, status: 'ACTIVE' };
    const operations = new Map();
    const allocation = { id: 8, reservation_id: 4, warehouse_stock_level_id: 30,
      reserved_quantity: 100, consumed_quantity: 0, released_quantity: 0 };
    const client = { query: jest.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT * FROM inventory_reservations')) return { rowCount: 1, rows: [{ id: 4, warehouse_id: 10,
        stock_item_id: 20, document_type: 'request', document_id: '9', document_line_id: '2', quantity: 100,
        consumed_quantity: state.consumed, status: state.status }] };
      if (sql.startsWith('SELECT id,institute_id FROM warehouses')) return { rowCount: 1, rows: [{ id: 10, institute_id: 1 }] };
      if (sql.includes('FROM inventory_reservation_issue_operations')) {
        const row = operations.get(params[1]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.startsWith('SELECT * FROM inventory_transactions')) return { rowCount: 1, rows: [{ id: params[0], movement_type: 'ISSUE' }] };
      if (sql.includes('FROM inventory_transaction_allocations')) return { rowCount: 1, rows: [{ inventory_transaction_id: params[0], quantity: -40 }] };
      if (sql.includes('FROM inventory_reservation_allocations')) return { rowCount: 1, rows: [{ ...allocation,
        consumed_quantity: state.consumed, released_quantity: state.released }] };
      if (sql.startsWith('UPDATE warehouse_stock_levels SET reserved_quantity=reserved_quantity-')) {
        const amount = Number(params[1]); if (state.reserved < amount) return { rowCount: 0, rows: [] };
        state.reserved -= amount; return { rowCount: 1, rows: [{ id: 30 }] };
      }
      if (sql.startsWith('UPDATE inventory_reservation_allocations SET consumed_quantity')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('UPDATE inventory_reservation_allocations SET released_quantity')) { state.released += Number(params[1]); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith('UPDATE inventory_reservations SET consumed_quantity')) {
        state.consumed = Number(params[1]); state.status = params[2] ? 'CONSUMED' : 'ACTIVE'; return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('INSERT INTO inventory_reservation_issue_operations')) {
        operations.set(params[1], { reservation_id: params[0], idempotency_key: params[1], requested_quantity: params[2], inventory_movement_id: params[3] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SET status='RELEASED'")) { state.status = 'RELEASED'; return { rowCount: 1, rows: [{ ...state }] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };
    jest.resetModules();
    jest.doMock('../utils/withTransaction', () => async (work) => {
      const snapshot = { ...state };
      try { return await work(client); } catch (error) { state = snapshot; throw error; }
    });
    jest.doMock('../services/inventoryPostingService', () => ({ postMovement: jest.fn(async (command) => {
      if (failPosting) throw new Error('posting failed');
      expect(state.reserved).toBe(100 - command.quantity - state.consumed);
      state.onHand -= command.quantity;
      return { movement: { id: 50 }, allocations: command.allocationOverrides };
    }) }));
    return { service: require('../services/inventoryReservationService'), getState: () => state };
  }

  test('reserve 100 / issue 40 / issue 60 consumes only each exact portion', async () => {
    const h = harness();
    await h.service.issue({ reservationId: 4, quantity: 40, idempotencyKey: 'i-1', actor: scopedActor });
    expect(h.getState()).toEqual({ onHand: 60, reserved: 60, consumed: 40, released: 0, status: 'ACTIVE' });
    await h.service.issue({ reservationId: 4, quantity: 60, idempotencyKey: 'i-2', actor: scopedActor });
    expect(h.getState()).toEqual({ onHand: 0, reserved: 0, consumed: 100, released: 0, status: 'CONSUMED' });
  });

  test('R1 retry cannot consume coordinator state twice and conflicting reuse is rejected', async () => {
    const h = harness();
    const first = await h.service.issue({ reservationId: 4, quantity: 40, idempotencyKey: 'R1', actor: scopedActor });
    expect(first.idempotent).toBe(false);
    const retry = await h.service.issue({ reservationId: 4, quantity: 40, idempotencyKey: 'R1', actor: scopedActor });
    expect(retry.idempotent).toBe(true);
    expect(h.getState()).toEqual({ onHand: 60, reserved: 60, consumed: 40, released: 0, status: 'ACTIVE' });
    await expect(h.service.issue({ reservationId: 4, quantity: 30, idempotencyKey: 'R1', actor: scopedActor }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
    await h.service.issue({ reservationId: 4, quantity: 60, idempotencyKey: 'R2', actor: scopedActor });
    expect(h.getState()).toEqual({ onHand: 0, reserved: 0, consumed: 100, released: 0, status: 'CONSUMED' });
  });

  test('issue requires an explicit non-empty operation key', async () => {
    const h = harness();
    await expect(h.service.issue({ reservationId: 4, quantity: 40, actor: scopedActor }))
      .rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY', statusCode: 400 });
  });

  test('release after partial issue releases only the remaining reservation', async () => {
    const h = harness();
    await h.service.issue({ reservationId: 4, quantity: 40, idempotencyKey: 'partial-release', actor: scopedActor });
    await h.service.release({ reservationId: 4, actor: scopedActor });
    expect(h.getState()).toEqual({ onHand: 60, reserved: 0, consumed: 40, released: 60, status: 'RELEASED' });
  });

  test('posting failure rolls back the prior reserved_quantity reduction', async () => {
    const h = harness({ failPosting: true });
    await expect(h.service.issue({ reservationId: 4, quantity: 40, idempotencyKey: 'posting-fails', actor: scopedActor })).rejects.toThrow('posting failed');
    expect(h.getState()).toEqual({ onHand: 100, reserved: 100, consumed: 0, released: 0, status: 'ACTIVE' });
  });

  test('cross-warehouse issue and unauthorized release are denied', async () => {
    const h = harness();
    await expect(h.service.issue({ reservationId: 4, quantity: 1, idempotencyKey: 'wrong-scope', actor: { ...scopedActor, warehouse_id: 11 } }))
      .rejects.toMatchObject({ code: 'WAREHOUSE_SCOPE_DENIED' });
    await expect(h.service.release({ reservationId: 4, actor: { ...scopedActor, permissions: [], permissionSet: new Set() } }))
      .rejects.toMatchObject({ code: 'INVENTORY_PERMISSION_DENIED' });
  });
});

describe('transfer receipt state and idempotency behavior', () => {
  const actor = { id: 7, active: true, permissions: ['inventory.transfer'] };

  function loadService(state) {
    jest.resetModules();
    jest.doMock('../utils/withTransaction', () => (work) => work(state.client));
    jest.doMock('../services/inventoryPostingService', () => ({ postMovement: jest.fn(async (command) => {
      state.posted.push({ key: command.idempotencyKey, quantity: command.quantity, batch: command.batchNumber });
      return { movement: { id: state.posted.length }, allocations: [] };
    }) }));
    jest.doMock('../services/inventoryReversalService', () => ({ reverseMovement: jest.fn() }));
    return require('../services/warehouseTransferService');
  }

  function inTransitHarness({ status = 'Dispatched', links = true } = {}) {
    const state = { status, posted: [], operations: new Map(), lineReceived: 0,
      allocations: [{ id: 1, dispatch_allocation_id: 101, dispatched_quantity: 5, received_quantity: 0, batch_number: 'A', allocation_sequence: 1 },
        { id: 2, dispatch_allocation_id: 102, dispatched_quantity: 7, received_quantity: 0, batch_number: 'B', allocation_sequence: 2 }] };
    state.client = { query: jest.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT * FROM warehouse_transfer_requests')) return { rowCount: 1, rows: [{ id: 3, status: state.status, destination_warehouse_id: 10 }] };
      if (sql.startsWith('SELECT * FROM inventory_transfer_receipt_operations')) { const row = state.operations.get(params[1]); return { rowCount: row ? 1 : 0, rows: row ? [row] : [] }; }
      if (sql.startsWith('SELECT institute_id FROM warehouses')) return { rowCount: 1, rows: [{ institute_id: 1 }] };
      if (sql.includes('FROM warehouse_transfer_items wti')) return links ? { rowCount: 1, rows: [{ id: 9, stock_item_id: 20, dispatch_movement_id: 40, dispatched_quantity: 12, received_quantity: state.lineReceived }] } : { rowCount: 0, rows: [] };
      if (sql.includes('FROM inventory_transfer_allocation_links l')) return { rowCount: 2, rows: state.allocations.map(row => ({ ...row })) };
      if (sql.startsWith('UPDATE inventory_transfer_allocation_links')) { const row = state.allocations.find(item => item.id === params[0]); row.received_quantity += Number(params[1]); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith('UPDATE inventory_transfer_movement_links')) { state.lineReceived += Number(params[1]); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith('SELECT COALESCE(SUM')) return { rowCount: 1, rows: [{ remaining: 12 - state.lineReceived }] };
      if (sql.startsWith('UPDATE warehouse_transfer_requests')) { state.status = params[1]; return { rowCount: 1, rows: [{ id: 3, status: state.status }] }; }
      if (sql.startsWith('INSERT INTO inventory_transfer_receipt_operations')) { const row = { id: state.operations.size + 1, transfer_id: 3, idempotency_key: params[1] }; state.operations.set(params[1], row); return { rowCount: 1, rows: [row] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };
    return { state, service: loadService(state) };
  }

  test.each(['Pending', 'Approved', 'Cancelled', 'Received'])('rejects receipt from %s', async (status) => {
    const h = inTransitHarness({ status });
    await expect(h.service.receiveTransfer({ transferId: 3, idempotencyKey: 'R1', actor }))
      .rejects.toMatchObject({ code: 'INVALID_TRANSFER_STATE' });
  });

  test('cannot mark a transfer received without dispatch links', async () => {
    const h = inTransitHarness({ links: false });
    await expect(h.service.receiveTransfer({ transferId: 3, idempotencyKey: 'R1', actor }))
      .rejects.toMatchObject({ code: 'TRANSFER_NOT_DISPATCHED' });
  });

  test('R1 retry is idempotent while R2 is a second A5/B1 then B6 receipt', async () => {
    const h = inTransitHarness();
    const first = await h.service.receiveTransfer({ transferId: 3, idempotencyKey: 'R1', quantities: { 9: 6 }, actor });
    expect(first.idempotent).toBe(false);
    expect(h.state.posted.map(({ batch, quantity }) => [batch, quantity])).toEqual([['A', 5], ['B', 1]]);
    const retry = await h.service.receiveTransfer({ transferId: 3, idempotencyKey: 'R1', quantities: { 9: 6 }, actor });
    expect(retry.idempotent).toBe(true);
    expect(h.state.posted).toHaveLength(2);
    await h.service.receiveTransfer({ transferId: 3, idempotencyKey: 'R2', quantities: { 9: 6 }, actor });
    expect(h.state.posted.map(({ batch, quantity }) => [batch, quantity])).toEqual([['A', 5], ['B', 1], ['B', 6]]);
    expect(h.state.status).toBe('Received');
  });
});