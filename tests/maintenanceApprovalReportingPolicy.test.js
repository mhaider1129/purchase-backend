const express = require('express');
const request = require('supertest');
jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({ authenticateUser: (req, res, next) => req.user ? next() : res.sendStatus(401) }));
const pool = require('../config/db');
const routes = require('../routes/maintenanceApprovalReportingPolicy');
function app(permissions) {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { if (permissions) req.user = { id: 1, permissions }; next(); });
  server.use('/policy', routes);
  server.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }));
  return server;
}
beforeEach(() => { jest.clearAllMocks(); pool.query.mockResolvedValue({ rows: [{ available: false }] }); });
test('authenticated readers receive an unset target before migration; unauthenticated users cannot read', async () => {
  await request(app([])).get('/policy').expect(200, { configured: false, overdue_target_days: null });
  await request(app(null)).get('/policy').expect(401);
});
test('policy writes require central management permission before any database access', async () => {
  await request(app([])).put('/policy').send({ overdue_target_days: 2, reason: 'Test' }).expect(403);
  expect(pool.connect).not.toHaveBeenCalled();
});
test.each([0, 366, 1.5, '2', undefined])('invalid target %s is rejected', async (days) => {
  const client = { query: jest.fn(), release: jest.fn() }; pool.connect.mockResolvedValue(client);
  await request(app(['permissions.manage'])).put('/policy').send({ overdue_target_days: days, reason: 'Test' }).expect(400);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK'); expect(client.release).toHaveBeenCalled();
});
test('missing migration returns actionable error and rolls back', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [{ available: false }] }), release: jest.fn() }; pool.connect.mockResolvedValue(client);
  await request(app(['permissions.manage'])).put('/policy').send({ overdue_target_days: 2, reason: 'Test' }).expect(503);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});

test.each(['', ' ', 'a'.repeat(2001), { text: 'invalid' }])('invalid reason is rejected before reading or writing policy', async (reason) => {
  const client = { query: jest.fn(), release: jest.fn() }; pool.connect.mockResolvedValue(client);
  await request(app(['permissions.manage'])).put('/policy').send({ overdue_target_days: 2, reason }).expect(400);
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
});
test('saving and clearing target writes policy and audit atomically; audit failure rolls back', async () => {
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (sql.includes('to_regclass')) return { rows: [{ available: true }] };
    if (sql.startsWith('SELECT overdue')) return { rows: [{ overdue_target_days: 3 }] };
    if (sql.startsWith('UPDATE public.maintenance')) return { rows: [{ overdue_target_days: params[0] }] };
    return { rows: [{}] };
  }) }; pool.connect.mockResolvedValue(client);
  for (const days of [2, null]) {
    await request(app(['permissions.manage'])).put('/policy').send({ overdue_target_days: days, reason: 'Reviewed' }).expect(200, { overdue_target_days: days, configured: true });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  }
  expect(client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO audit_logs'))).toBe(true);
  client.query.mockImplementation(async (sql) => { if (sql.startsWith('INSERT INTO audit_logs')) throw new Error('Audit unavailable'); if (sql.includes('to_regclass')) return { rows: [{ available: true }] }; return { rows: [{ overdue_target_days: 2 }] }; });
  client.query.mockClear();
  await request(app(['permissions.manage'])).put('/policy').send({ overdue_target_days: 2, reason: 'Reviewed' }).expect(500);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.query).not.toHaveBeenCalledWith('COMMIT');
});
