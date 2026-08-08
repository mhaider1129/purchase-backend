jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../controllers/requests/assignRequestController', () => ({
  ensureRequestedItemAssignmentColumns: jest.fn().mockResolvedValue(),
}));

const pool = require('../config/db');
const { getAllRequests } = require('../controllers/requests/fetchRequestsController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('fetchRequestsController.getAllRequests filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
  });

  it.each(['operational', 'medical'])('filters requests by the %s domain', async (requestDomain) => {
    const req = {
      query: { request_domain: requestDomain },
      user: { institute_id: null },
    };
    const res = buildRes();

    await getAllRequests(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('LOWER(TRIM(r.request_domain)) = $1'),
      [requestDomain, 10, 0],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('LOWER(TRIM(r.request_domain)) = $1'),
      [requestDomain],
    );
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, limit: 10 });
  });

  it('ignores unsupported domain values', async () => {
    const req = {
      query: { request_domain: 'financial' },
      user: { institute_id: null },
    };
    const res = buildRes();

    await getAllRequests(req, res);

    expect(pool.query.mock.calls[0][0]).not.toContain('LOWER(TRIM(r.request_domain))');
    expect(pool.query.mock.calls[0][1]).toEqual([10, 0]);
  });

  it('filters the current step by the terminal Available in Stock status', async () => {
    const req = {
      query: { current_step: 'Available in Stock' },
      user: { institute_id: null },
    };
    const res = buildRes();

    await getAllRequests(req, res);

    expect(pool.query.mock.calls[0][0]).toContain(
      "LOWER(TRIM(r.status)) = 'available in stock'",
    );
    expect(pool.query.mock.calls[0][0]).not.toContain('step_user.role =');
    expect(pool.query.mock.calls[0][1]).toEqual([10, 0]);
  });
});