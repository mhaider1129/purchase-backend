jest.mock('../config/db', () => ({ connect: jest.fn() }));
jest.mock('../controllers/utils/approvalRoutes', () => ({
  resolveRouteDomain: jest.fn(),
  fetchApprovalRoutes: jest.fn(),
}));
jest.mock('../controllers/utils/initializeApprovals', () => ({
  initializeApprovals: jest.fn(),
}));

const pool = require('../config/db');
const { resolveRouteDomain, fetchApprovalRoutes } = require('../controllers/utils/approvalRoutes');
const { initializeApprovals } = require('../controllers/utils/initializeApprovals');
const { rewireRequestType } = require('../controllers/requests/updateRequestsController');

describe('rewireRequestType', () => {
  beforeEach(() => jest.clearAllMocks());

  it('changes the type and rebuilds approvals in one transaction for SCM', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 603,
            request_type: 'Non-Stock',
            department_id: 8,
            request_domain: 'operational',
            estimated_cost: 1000,
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    resolveRouteDomain.mockResolvedValue('operational');
    fetchApprovalRoutes.mockResolvedValue([{ approval_level: 1, role: 'HOD' }]);
    initializeApprovals.mockResolvedValue();

    const req = {
      params: { id: '603' },
      body: { request_type: 'IT Item' },
      user: { id: 22, role: 'SCM' },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await rewireRequestType(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fetchApprovalRoutes).toHaveBeenCalledWith(expect.objectContaining({
      client,
      requestType: 'IT Item',
      departmentType: 'operational',
      amount: 1000,
    }));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET request_type = $1'),
      ['IT Item', 'operational', 603],
    );
    expect(client.query).toHaveBeenCalledWith('DELETE FROM approvals WHERE request_id = $1', [603]);
    expect(initializeApprovals).toHaveBeenCalledWith(603, client);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 603,
      request_type: 'IT Item',
    }));
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects users who are not SCM before opening a transaction', async () => {
    const next = jest.fn();
    await rewireRequestType(
      { params: { id: '603' }, body: { request_type: 'Stock' }, user: { role: 'admin' } },
      { json: jest.fn() },
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(pool.connect).not.toHaveBeenCalled();
  });
});