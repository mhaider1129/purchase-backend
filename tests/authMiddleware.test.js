jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const pool = require('../config/db');
const jwt = require('jsonwebtoken');

const { authenticateUser, authenticateUserOptional } = require('../middleware/authMiddleware');

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('authenticateUser middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ user_id: 1 });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it.each([undefined, '', 'Basic token', 'Bearer', 'Bearer a b'])(
    'marks missing/malformed credentials %p as a definitive session failure',
    async (authorization) => {
      const next = jest.fn();
      await authenticateUser({ headers: { authorization } }, createResponse(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 401,
        code: 'INVALID_TOKEN',
        message: 'Unauthorized: Missing or malformed token',
      }));
      expect(jwt.verify).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it('keeps an absent optional token anonymous while rejecting a malformed supplied token', async () => {
    const anonymous = jest.fn();
    await authenticateUserOptional({ headers: {} }, createResponse(), anonymous);
    expect(anonymous).toHaveBeenCalledWith();
    const malformed = jest.fn();
    await authenticateUserOptional({ headers: { authorization: 'Basic token' } }, createResponse(), malformed);
    expect(malformed).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: 'INVALID_TOKEN' }));
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('responds with 503 when the database is unreachable', async () => {
    const dbError = Object.assign(new Error('getaddrinfo ENOTFOUND db.example.com'), {
      code: 'ENOTFOUND',
    });

    pool.query.mockRejectedValueOnce(dbError);

    const req = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponse();
    const next = jest.fn();

    await authenticateUser(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith('token', process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(pool.query).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'Service Unavailable: Unable to connect to the database',
      })
    );
  });

  it('passes through when a user is returned', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 1,
            name: 'Test User',
            role: 'admin',
            department_id: 2,
            is_active: true,
            can_request_medication: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            role: 'admin',
            permissions: ['recalls.view'],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { code: 'dashboard.view' },
          { code: 'permissions.manage' },
        ],
      });

    const req = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponse();
    const next = jest.fn();

    await authenticateUser(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 1,
        role: 'admin',
        permissions: ['dashboard.view', 'permissions.manage'],
      })
    );
  });

  it('fails closed when permission lookup tables are unavailable', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 1,
            name: 'Test User',
            role: 'ProcurementSpecialist',
            department_id: 2,
            is_active: true,
            can_request_medication: false,
          },
        ],
      })
      .mockRejectedValueOnce(Object.assign(new Error('relation "user_permissions" does not exist'), { code: '42P01' }));

    const req = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponse();
    const next = jest.fn();

    await authenticateUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
      code: 'AUTHORIZATION_SERVICE_UNAVAILABLE',
    }));
  });

  it('falls back to 500 for unexpected errors', async () => {
    const unexpectedError = new Error('boom');
    pool.query.mockRejectedValueOnce(unexpectedError);

    const req = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponse();
    const next = jest.fn();

    await authenticateUser(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Authentication middleware failed',
      })
    );
  });
});