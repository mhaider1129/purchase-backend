const jwt = require('jsonwebtoken');

jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/permissionService', () => ({
  getPermissionsForUserId: jest.fn(),
  buildPermissionSet: jest.fn(() => new Set()),
  userHasPermission: jest.fn(() => true),
}));

jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn(() => Promise.resolve()));

const pool = require('../config/db');
const { getPermissionsForUserId } = require('../utils/permissionService');
const { authenticateUser } = require('../middleware/authMiddleware');

describe('authenticateUser middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects missing authorization header', async () => {
    const req = { headers: {} };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: 'Unauthorized: Missing or malformed token',
      })
    );
  });

  test('rejects invalid token', async () => {
    const req = { headers: { authorization: 'Bearer invalid-token' } };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects inactive user', async () => {
    const token = jwt.sign({ user_id: 1 }, process.env.JWT_SECRET);

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 1, name: 'Inactive User', role: 'Requester', department_id: 10,
        institute_id: 1, warehouse_id: null, is_active: false, can_request_medication: false,
      }],
    });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: 'Unauthorized: User is deactivated' })
    );
  });

  test('attaches active user context to request', async () => {
    const token = jwt.sign({ user_id: 1 }, process.env.JWT_SECRET);

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 1, name: 'Active User', role: 'Requester', department_id: 10,
        institute_id: 1, warehouse_id: null, is_active: true, can_request_medication: false,
      }],
    });
    getPermissionsForUserId.mockResolvedValueOnce({ permissions: ['requests:create'], dataScopes: {} });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(req.user).toEqual(expect.objectContaining({ id: 1, role: 'Requester', department_id: 10, institute_id: 1 }));
    expect(next).toHaveBeenCalledWith();
  });
});