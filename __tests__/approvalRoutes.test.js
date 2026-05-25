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
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM approval_route_rules'), expect.arrayContaining([1, 'Stock', 'medical', 5000]));
    expect(routes).toHaveLength(2);
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