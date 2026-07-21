jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');
const { getPendingApprovals } = require('../controllers/requests/fetchRequestsController');

describe('fetchRequestsController.getPendingApprovals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns active pending and on-hold approvals with their status', async () => {
    const approvals = [
      { approval_id: 10, approval_status: 'Pending' },
      { approval_id: 11, approval_status: 'On Hold' },
    ];
    pool.query.mockResolvedValue({ rows: approvals });

    const req = { user: { id: 7 } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getPendingApprovals(req, res, next);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("a.status IN ('Pending', 'On Hold')"),
      [7],
    );
    const pendingApprovalsQuery = pool.query.mock.calls.find(([sql]) =>
      sql.includes("a.status IN ('Pending', 'On Hold')"),
    )?.[0];
    expect(pendingApprovalsQuery).toContain('a.status AS approval_status');
    expect(res.json).toHaveBeenCalledWith(approvals);
    expect(next).not.toHaveBeenCalled();
  });
});