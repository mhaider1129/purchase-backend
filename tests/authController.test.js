const { login } = require('../controllers/authController');
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

jest.mock('../config/db', () => ({
  query: jest.fn()
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn()
}));

describe('authController.login', () => {
  it('returns 400 when email or password missing', async () => {
    const req = { body: {} };
    const res = { json: jest.fn() };
    const next = jest.fn();
    await login(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('returns token and user on success', async () => {
    const user = { id: 1, name: 'Test', email: 'test@example.com', password: 'hashed', role: 'User', department_id: 1, section_id: 2 };
    pool.query.mockResolvedValue({ rows: [user] });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('mocktoken');
    process.env.JWT_SECRET = 'secret';

    const req = { body: { email: 'test@example.com', password: 'pass' } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await login(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mocktoken', user: expect.objectContaining({ id: 1 }) }));
  });
});