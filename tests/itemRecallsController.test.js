const {
  listVisibleRecalls,
  createDepartmentRecallRequest,
  createWarehouseRecallRequest,
  escalateRecallToProcurement,
} = require('../controllers/itemRecallsController');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(null),
}));

const db = require('../config/db');

describe('itemRecallsController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects department recall without a reason', async () => {
    const req = {
      body: { item_name: 'Mask', quantity: 5 },
      user: { id: 5, department_id: 3 },
    };
    const res = {};
    const next = jest.fn();

    await createDepartmentRecallRequest(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('falls back to provided item name when referenced stock item is missing', async () => {
    const req = {
      body: {
        item_id: 42,
        item_name: 'Old gloves',
        quantity: 3,
        reason: 'Expired stock',
      },
      user: { id: 7, department_id: 2 },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            item_id: null,
            item_name: 'Old gloves',
            quantity: 3,
            reason: 'Expired stock',
          },
        ],
      });

    await createDepartmentRecallRequest(req, res, next);

    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO item_recalls'),
      [null, 'Old gloves', 3, 'Expired stock', '', 2, 7],
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Recall request submitted to the warehouse',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('prevents non-warehouse users from creating procurement recalls', async () => {
    const req = {
      body: { reason: 'Damaged goods' },
      user: { id: 2, department_id: 1, role: 'Requester' },
    };
    const res = {};
    const next = jest.fn();

    await createWarehouseRecallRequest(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('validates recall identifier before escalation', async () => {
    const req = {
      params: { id: 'abc' },
      user: { role: 'WarehouseManager', id: 10 },
    };
    const res = {};
    const next = jest.fn();

    await escalateRecallToProcurement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('prevents unauthorized roles from viewing recalls', async () => {
    const req = {
      user: { role: 'Requester' },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await listVisibleRecalls(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('fetches procurement-facing recalls for procurement roles', async () => {
    const req = {
      user: { role: 'ProcurementSpecialist' },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, recall_type: 'warehouse_to_procurement', item_name: 'Mask' },
      ],
    });

    await listVisibleRecalls(req, res, next);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM item_recalls'),
      ['warehouse_to_procurement'],
    );
    expect(res.json).toHaveBeenCalledWith({
      recalls: [
        { id: 1, recall_type: 'warehouse_to_procurement', item_name: 'Mask' },
      ],
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('fetches recall queue for warehouse roles', async () => {
    const req = {
      user: { role: 'WarehouseManager' },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    db.query.mockResolvedValueOnce({ rows: [] });

    await listVisibleRecalls(req, res, next);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ir.recall_type = ANY($1)'),
      [['department_to_warehouse', 'warehouse_to_procurement']],
    );
    expect(res.json).toHaveBeenCalledWith({ recalls: [] });
    expect(next).not.toHaveBeenCalled();
  });
});