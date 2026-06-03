jest.mock('../config/db', () => ({ query: jest.fn() }));

jest.mock('../controllers/utils/approvalRouteVersioning', () => ({
  ensureApprovalRouteVersioning: jest.fn(() => Promise.resolve()),
  getActiveVersion: jest.fn(),
}));

const pool = require('../config/db');
const { getActiveVersion } = require('../controllers/utils/approvalRouteVersioning');
const { fetchApprovalRoutes, resolveRouteDomain } = require('../controllers/utils/approvalRoutes');

describe('approval route utilities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty routes when request type is missing', async () => {
    const routes = await fetchApprovalRoutes({ requestType: '', departmentType: 'medical', amount: 1000 });
    expect(routes).toEqual([]);
  });

  test('normalizes amount and fetches active approval rules', async () => {
    getActiveVersion.mockResolvedValueOnce({ id: 1 });
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 1, request_type: 'Stock', department_type: 'medical', approval_level: 1, role: 'HOD' },
      { id: 2, request_type: 'Stock', department_type: 'medical', approval_level: 2, role: 'CMO' },
    ]});

    const routes = await fetchApprovalRoutes({ requestType: ' Stock ', departmentType: ' Medical ', amount: '5000.75' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM approval_route_rules'), [1, 'Stock', 'medical', 5000, 0]);
    expect(routes).toHaveLength(2);
  });

  test('keeps lower approval levels when the request amount exceeds their maximum approval cap', async () => {
    getActiveVersion.mockResolvedValueOnce({ id: 2 });
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 85, request_type: 'Non-Stock', department_type: 'operational', approval_level: 1, role: 'HOD', min_amount: 0, max_amount: 10000000 },
      { id: 86, request_type: 'Non-Stock', department_type: 'operational', approval_level: 2, role: 'WarehouseManager', min_amount: 0, max_amount: 10000000 },
      { id: 87, request_type: 'Non-Stock', department_type: 'operational', approval_level: 3, role: 'SCM', min_amount: 0, max_amount: 10000000 },
      { id: 88, request_type: 'Non-Stock', department_type: 'operational', approval_level: 4, role: 'CFO', min_amount: 5000001, max_amount: 999999999 },
    ]});

    const routes = await fetchApprovalRoutes({ requestType: 'Non-Stock', departmentType: 'operational', amount: 30000000 });
    const routeQuery = pool.query.mock.calls[0][0];

    expect(routeQuery).toContain('AND $4 >= COALESCE(min_amount, $5)');
    expect(routeQuery).not.toContain('BETWEEN COALESCE(min_amount');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM approval_route_rules'), [2, 'Non-Stock', 'operational', 30000000, 0]);
    expect(routes.map(route => route.role)).toEqual(['HOD', 'WarehouseManager', 'SCM', 'CFO']);
  });

  test('resolves department type from database', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'Medical' }] });
    const domain = await resolveRouteDomain({ departmentId: 5, requestType: 'Non-Stock' });
    expect(domain).toBe('medical');
  });

  test('warehouse supply prefers explicit domain', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'Operational' }] });
    const domain = await resolveRouteDomain({ departmentId: 5, explicitDomain: 'Medical', requestType: 'Warehouse Supply' });
    expect(domain).toBe('medical');
  });
});