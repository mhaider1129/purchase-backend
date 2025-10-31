jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const pool = require('../config/db');
const jwt = require('jsonwebtoken');

const { authenticateUser } = require('../middleware/authMiddleware');

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

    expect(jwt.verify).toHaveBeenCalledWith('token', process.env.JWT_SECRET);
    expect(pool.query).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'Service Unavailable: Unable to connect to the database',
      })
    );
  });

  it('passes through when a user is returned', async () => {
    pool.query.mockResolvedValueOnce({
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
      })
    );
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