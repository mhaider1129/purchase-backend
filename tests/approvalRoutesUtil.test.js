jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../controllers/utils/approvalRouteVersioning', () => ({
  ensureApprovalRouteVersioning: jest.fn(),
  getActiveVersion: jest.fn(),
}));

const pool = require('../config/db');
const {
  ensureApprovalRouteVersioning,
  getActiveVersion,
} = require('../controllers/utils/approvalRouteVersioning');
const { fetchApprovalRoutes } = require('../controllers/utils/approvalRoutes');

describe('approval route utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty array when there is no active version', async () => {
    ensureApprovalRouteVersioning.mockResolvedValueOnce();
    getActiveVersion.mockResolvedValueOnce(null);

    const routes = await fetchApprovalRoutes({
      requestType: 'Stock',
      departmentType: 'medical',
      amount: 500,
    });

    expect(routes).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reads route rules from the active version tables', async () => {
    ensureApprovalRouteVersioning.mockResolvedValueOnce();
    getActiveVersion.mockResolvedValueOnce({ id: 11, version_label: 'v11' });
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          request_type: 'Stock',
          department_type: 'medical',
          approval_level: 1,
          role: 'HOD',
          min_amount: 0,
          max_amount: 1000,
        },
      ],
    });

    const routes = await fetchApprovalRoutes({
      requestType: 'Stock',
      departmentType: 'Medical',
      amount: 100,
    });

    expect(ensureApprovalRouteVersioning).toHaveBeenCalledWith(pool);
    expect(getActiveVersion).toHaveBeenCalledWith(pool);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM approval_route_rules'),
      [11, 'Stock', 'medical', 100, 0, 999999999],
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].role).toBe('HOD');
  });
});