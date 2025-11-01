const {
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

describe('itemRecallsController', () => {
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
});