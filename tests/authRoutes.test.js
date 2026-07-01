jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  genSalt: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
}));

jest.mock('../utils/permissionService', () => ({
  getPermissionsForUserId: jest.fn(),
  applyDefaultRolePermissions: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
  authenticateUser: (req, _res, next) => {
    req.user = { id: 1 };
    next();
  },
}));

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { getPermissionsForUserId } = require('../utils/permissionService');

const router = require('../routes/auth');

const getRouteHandler = (path, method = 'post') => {
  const layer = router.stack.find(
    (stack) => stack.route && stack.route.path === path && stack.route.methods[method]
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} ${path} route is not registered`);
  }

  const handlerLayer = layer.route.stack[layer.route.stack.length - 1];
  return handlerLayer.handle;
};

const getChangePasswordHandler = () => {
  return getRouteHandler('/change-password', 'put');
};


describe('POST /auth/login', () => {
  const handler = getRouteHandler('/login');

  const createResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getPermissionsForUserId.mockResolvedValue({ permissions: [] });
  });

  it('matches email logins case-insensitively', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 65,
        name: 'Ali Ashoor',
        email: 'Ali.Ashoor@whf.org.iq',
        password: 'hashed-password',
        role: 'Requester',
        is_active: true,
      }],
    });
    bcrypt.compare.mockResolvedValueOnce(true);

    const req = { body: { login: 'Ali.Ashoor@whf.org.iq', password: '1234' } };
    const res = createResponse();

    await handler(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(email) = $1'),
      ['ali.ashoor@whf.org.iq', 'Ali.Ashoor@whf.org.iq', '', null]
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, token: 'signed-token' }));
  });
});

describe('PUT /auth/change-password', () => {
  const handler = getChangePasswordHandler();

  const createResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const req = { body: {}, user: { id: 1 } };
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('required'),
      })
    );
  });

  it('returns 401 when current password is incorrect', async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ password: 'hashed' }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);

    const req = { body: { currentPassword: 'old', newPassword: 'newPassword1' }, user: { id: 1 } };
    const res = createResponse();

    await handler(req, res);

    expect(pool.query).toHaveBeenCalledWith('SELECT password FROM users WHERE id = $1', [1]);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('incorrect'),
      })
    );
  });

  it('updates password when validation passes', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ password: 'hashed' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    bcrypt.compare
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-new');

    const req = { body: { currentPassword: 'oldPassword1', newPassword: 'newPassword1' }, user: { id: 1 } };
    const res = createResponse();

    await handler(req, res);

    expect(bcrypt.genSalt).toHaveBeenCalledWith(10);
    expect(bcrypt.hash).toHaveBeenCalledWith('newPassword1', 'salt');
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM information_schema.columns'),
      ['public', 'users', 'updated_at']
    );

    expect(pool.query).toHaveBeenLastCalledWith(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      ['hashed-new', 1]
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
      })
    );
  });
});