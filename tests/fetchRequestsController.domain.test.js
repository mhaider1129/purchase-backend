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

  it('falls back to the initiating technician for maintenance requests without a requester', async () => {
    const req = {
      query: { search: 'Technician Name' },
      user: { institute_id: null },
    };
    const res = buildRes();

    await getAllRequests(req, res);

    const requestsQuery = pool.query.mock.calls[0][0];
    const countQuery = pool.query.mock.calls[1][0];

    expect(requestsQuery).toContain(
      "CASE WHEN r.request_type = 'Maintenance' THEN initiating_technician.name END",
    );
    expect(requestsQuery).toContain(
      'LEFT JOIN users initiating_technician ON r.initiated_by_technician_id = initiating_technician.id',
    );
    expect(countQuery).toContain(
      'LEFT JOIN users initiating_technician ON r.initiated_by_technician_id = initiating_technician.id',
    );
    expect(pool.query.mock.calls[0][1]).toEqual(['%technician name%', 10, 0]);
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, limit: 10 });
  });
});