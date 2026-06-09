jest.mock('../config/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../utils/ensureRequestedItemFinancialsTable', () => ({
  ensureRequestedItemFinancialsTable: jest.fn().mockResolvedValue(undefined),
}));

const pool = require('../config/db');
const { addProcurementItemEvent } = require('../controllers/requests/procurementItemEventsController');

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const buildRequest = (body = {}, user = {}) => ({
  params: { requestId: '10', itemId: '20' },
  body,
  user: {
    id: 7,
    role: 'ProcurementSpecialist',
    hasPermission: jest.fn(() => false),
    ...user,
  },
});

const buildClient = ({ itemOverrides = {}, requestOverrides = {}, allFully = false } = {}) => {
  const client = { query: jest.fn(), release: jest.fn() };
  const state = {
    item: {
      id: 20,
      request_id: 10,
      item_name: 'Gloves',
      quantity: 100,
      purchased_quantity: 0,
      unit_cost: 5,
      total_cost: 0,
      procurement_status: 'pending',
      assigned_to: null,
      ...itemOverrides,
    },
    request: { id: 10, status: 'Approved', assigned_to: 7, ...requestOverrides },
  };

  client.query.mockImplementation(async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
    if (/SELECT id, status, assigned_to FROM requests/.test(sql)) {
      return { rowCount: 1, rows: [state.request] };
    }
    if (/FROM public\.requested_items ri\s+JOIN requests r/.test(sql)) {
      return { rowCount: 1, rows: [{ ...state.item, request_assigned_to: state.request.assigned_to }] };
    }
    if (/SELECT id, name FROM suppliers/.test(sql)) return { rowCount: 1, rows: [{ id: params[0], name: 'ABC Supplier' }] };
    if (/INSERT INTO public\.procurement_item_events/.test(sql)) {
      return {
        rowCount: 1,
        rows: [{
          id: 1,
          request_id: params[0],
          requested_item_id: params[1],
          procurement_user_id: params[2],
          event_quantity: params[3],
          previous_purchased_quantity: params[4],
          new_purchased_quantity: params[5],
          remaining_quantity: params[6],
          unit_cost: params[7],
          total_cost: params[8],
          supplier_id: params[9],
          supplier_name: params[10],
        }],
      };
    }
    if (/UPDATE public\.requested_items/.test(sql)) {
      state.item = {
        ...state.item,
        purchased_quantity: params[0],
        unit_cost: params[1] ?? state.item.unit_cost,
        total_cost: params[2] ?? state.item.total_cost,
        procurement_status: params[3],
      };
      return { rowCount: 1, rows: [state.item] };
    }
    if (/INSERT INTO public\.requested_item_financials/.test(sql)) return {};
    if (/INSERT INTO request_logs/.test(sql)) return {};
    if (/COUNT\(\*\)::int AS total_items/.test(sql)) {
      return {
        rows: [{
          total_items: 1,
          fully_procured_items: allFully ? 1 : (state.item.purchased_quantity >= state.item.quantity ? 1 : 0),
          started_items: state.item.purchased_quantity > 0 ? 1 : 0,
        }],
      };
    }
    if (/UPDATE requests/.test(sql)) return {};
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return client;
};

describe('procurement item events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds the first procurement event and updates the item to Partially Procured', async () => {
    const client = buildClient();
    pool.connect.mockResolvedValue(client);
    const req = buildRequest({ event_quantity: 60, unit_cost: 5 });
    const res = buildResponse();
    const next = jest.fn();

    await addProcurementItemEvent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE OF ri'), [20, 10]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        event_quantity: 60,
        previous_purchased_quantity: 0,
        new_purchased_quantity: 60,
        remaining_quantity: 40,
      }),
      item: expect.objectContaining({
        purchased_quantity: 60,
        procurement_status: 'partially_procured',
      }),
    }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('adds the second procurement event and updates the item to Fully Procured', async () => {
    const client = buildClient({ itemOverrides: { purchased_quantity: 60, procurement_status: 'partially_procured' }, allFully: true });
    pool.connect.mockResolvedValue(client);
    const req = buildRequest({ event_quantity: 40, unit_cost: 5 });
    const res = buildResponse();
    const next = jest.fn();

    await addProcurementItemEvent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        event_quantity: 40,
        previous_purchased_quantity: 60,
        new_purchased_quantity: 100,
        remaining_quantity: 0,
      }),
      item: expect.objectContaining({
        purchased_quantity: 100,
        procurement_status: 'purchased',
      }),
      request_procurement_status: 'completed',
    }));
  });

  it('blocks an event quantity greater than remaining quantity', async () => {
    const client = buildClient({ itemOverrides: { purchased_quantity: 60, procurement_status: 'partially_procured' } });
    pool.connect.mockResolvedValue(client);
    const req = buildRequest({ event_quantity: 41 });
    const res = buildResponse();
    const next = jest.fn();

    await addProcurementItemEvent(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(next.mock.calls[0][0].message).toContain('remaining quantity (40)');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('blocks an event when the item is already fully procured', async () => {
    const client = buildClient({ itemOverrides: { purchased_quantity: 100, procurement_status: 'purchased' } });
    pool.connect.mockResolvedValue(client);
    const req = buildRequest({ event_quantity: 1 });
    const res = buildResponse();
    const next = jest.fn();

    await addProcurementItemEvent(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: 'Item is already fully procured, cancelled, or unable to procure',
    }));
  });

  it('preserves old purchased_quantity as the starting point when no events exist', async () => {
    const client = buildClient({ itemOverrides: { purchased_quantity: 25, procurement_status: 'pending' } });
    pool.connect.mockResolvedValue(client);
    const req = buildRequest({ event_quantity: 10 });
    const res = buildResponse();
    const next = jest.fn();

    await addProcurementItemEvent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        previous_purchased_quantity: 25,
        new_purchased_quantity: 35,
        remaining_quantity: 65,
      }),
      item: expect.objectContaining({
        purchased_quantity: 35,
        procurement_status: 'partially_procured',
      }),
    }));
  });
});