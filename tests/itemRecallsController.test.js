const {
  listVisibleRecalls,
  createDepartmentRecallRequest,
  createWarehouseRecallRequest,
  escalateRecallToProcurement,
  quarantineRecall,
} = require('../controllers/itemRecallsController');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(null),
}));

jest.mock('../utils/ensureItemRecallsTable', () => jest.fn().mockResolvedValue());

const db = require('../config/db');

const createPermissionHelpers = (grantedPermissions = []) => {
  const normalized = new Set(grantedPermissions.map(code => code.toLowerCase()));

  const hasPermission = jest.fn(code => normalized.has(String(code).toLowerCase()));
  const hasAnyPermission = jest.fn(codes =>
    Array.isArray(codes) && codes.some(code => normalized.has(String(code).toLowerCase()))
  );

  return {
    hasPermission,
    hasAnyPermission,
  };
};

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
      [
        null,
        'Old gloves',
        '',
        3,
        'Expired stock',
        '',
        '',
        '',
        '',
        '',
        '',
        2,
        7,
      ],
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
      user: {
        role: 'Requester',
        ...createPermissionHelpers([]),
      },
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
      user: {
        role: 'ProcurementSpecialist',
        ...createPermissionHelpers(['recalls.view', 'requests.manage']),
      },
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
      user: {
        role: 'WarehouseManager',
        ...createPermissionHelpers(['recalls.view', 'warehouse.manage-supply']),
      },
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

  it('quarantines a recall and notifies procurement', async () => {
    const req = {
      params: { id: '5' },
      body: { quarantine_reason: 'Failed inspection', lot_number: 'LOT-55' },
      user: {
        ...createPermissionHelpers(['recalls.manage', 'warehouse.manage-supply']),
        hasAnyPermission: jest.fn(() => true),
      },
    };

    const res = { json: jest.fn() };
    const next = jest.fn();

    const mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    db.connect.mockResolvedValue(mockClient);

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 5,
            item_name: 'Mask',
            lot_number: 'LOT-55',
            quarantine_active: false,
            status: 'Pending Warehouse Review',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            item_name: 'Mask',
            lot_number: 'LOT-55',
            quarantine_active: true,
            status: 'Quarantined - Block Issuance',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ email: 'procurement@example.com' }] })
      .mockResolvedValueOnce({}); // COMMIT

    await quarantineRecall(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Recall quarantined'),
      }),
    );
  });
});