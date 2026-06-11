jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../controllers/requests/assignRequestController', () => ({
  ensureRequestedItemAssignmentColumns: jest.fn().mockResolvedValue(),
}));

const pool = require('../config/db');
const { getAssignedRequests } = require('../controllers/requests/fetchRequestsController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('fetchRequestsController.getAssignedRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes the request department name for assigned request cards', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            request_type: 'Non-Stock',
            status: 'Approved',
            department_id: 5,
            department_name: 'Operations',
            estimated_cost: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      query: {},
      user: {
        id: 7,
        hasPermission: jest.fn(() => false),
      },
    };
    const res = buildRes();

    await getAssignedRequests(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('d.name AS department_name'),
      [7],
    );
    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('LEFT JOIN departments d ON r.department_id = d.id'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [
          expect.objectContaining({
            id: 42,
            department_id: 5,
            department_name: 'Operations',
          }),
        ],
      }),
    );
  });
});