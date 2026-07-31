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
const { authenticateUser, authenticateUserOptional, attachUserFromToken } = require('../middleware/authMiddleware');

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

  test('rejects a malformed Bearer header', async () => {
    const next = jest.fn();
    await authenticateUser({ headers: { authorization: 'Bearer token extra' } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects invalid token', async () => {
    const req = { headers: { authorization: 'Bearer invalid-token' } };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects an expired token', async () => {
    const token = jwt.sign({ user_id: 1, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    const next = jest.fn();
    await authenticateUser({ headers: { authorization: `Bearer ${token}` } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: 'INVALID_TOKEN' }));
  });

  test('rejects a nonexistent user', async () => {
    const token = jwt.sign({ user_id: 99 }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const next = jest.fn();
    await authenticateUser({ headers: { authorization: `Bearer ${token}` } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: 'USER_NOT_FOUND' }));
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
        id: 1, name: 'Active User', role: 'Requester', department_id: 10, section_id: 20,
        assigned_section_ids: [20, 21], institute_id: 1, warehouse_id: 30, is_active: true, can_request_medication: false,
      }],
    });
    getPermissionsForUserId.mockResolvedValueOnce({ permissions: ['requests:create'], dataScopes: {} });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    await authenticateUser(req, {}, next);

    expect(req.user).toEqual(expect.objectContaining({
      id: 1, role: 'Requester', department_id: 10, section_id: 20,
      assigned_section_ids: [20, 21], institute_id: 1, warehouse_id: 30,
    }));
    expect(next).toHaveBeenCalledWith();
  });

  test('fails closed when permission lookup fails', async () => {
    const token = jwt.sign({ user_id: 1 }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, role: 'Requester', is_active: true }] });
    getPermissionsForUserId.mockRejectedValueOnce(Object.assign(new Error('missing relation'), { code: '42P01' }));
    const next = jest.fn();
    await authenticateUser({ headers: { authorization: `Bearer ${token}` } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, code: 'AUTHORIZATION_SERVICE_UNAVAILABLE' }));
  });

  test('optional authentication permits a missing token but rejects an invalid token', async () => {
    const missingNext = jest.fn();
    await authenticateUserOptional({ headers: {} }, {}, missingNext);
    expect(missingNext).toHaveBeenCalledWith();
    const invalidNext = jest.fn();
    await authenticateUserOptional({ headers: { authorization: 'Bearer invalid' } }, {}, invalidNext);
    expect(invalidNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects a token without a numeric user_id', async () => {
    const token = jwt.sign({ subject: 'one' }, process.env.JWT_SECRET);
    await expect(attachUserFromToken(token)).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_TOKEN_SUBJECT' });
  });
});