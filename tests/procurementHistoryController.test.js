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

  it('fetches completed, received, and available-in-stock requests assigned to the current user', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 101, status: 'completed' },
        { id: 102, status: 'Received' },
        { id: 103, status: 'Available in Stock' },
      ],
    });

    const req = {
      query: {},
      user: { id: 7,institute_id:1 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getCompletedAssignedRequests(req, res, next);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(
        require('../services/requestFulfillmentSql').effectiveRequestStatusSql('r'),
      ),
      [7,[1],7],
    );
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { id: 101, status: 'completed' },
        { id: 102, status: 'Received' },
        { id: 103, status: 'Available in Stock' },
      ],
    });
    expect(next).not.toHaveBeenCalled();
  });
});