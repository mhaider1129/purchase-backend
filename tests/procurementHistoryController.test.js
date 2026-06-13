jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');
const { getCompletedAssignedRequests } = require('../controllers/requests/procurementHistoryController');

const buildRes = () => {
  const res = {};
  res.json = jest.fn(() => res);
  return res;
};

describe('procurementHistoryController.getCompletedAssignedRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches both completed and received requests assigned to the current user', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 101, status: 'completed' },
        { id: 102, status: 'Received' },
      ],
    });

    const req = {
      query: {},
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getCompletedAssignedRequests(req, res, next);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("LOWER(TRIM(r.status)) IN ('completed', 'received')"),
      [7],
    );
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { id: 101, status: 'completed' },
        { id: 102, status: 'Received' },
      ],
    });
    expect(next).not.toHaveBeenCalled();
  });
});