jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn().mockResolvedValue());
jest.mock('../utils/ensureWarehouseSupplyTables', () => ({
  ensureWarehouseSupplyApprovalColumns: jest.fn().mockResolvedValue(),
}));
jest.mock('../controllers/requests/assignRequestController', () => ({
  ensureRequestedItemAssignmentColumns: jest.fn().mockResolvedValue(),
}));

const pool = require('../config/db');
const { getApprovalHistory } = require('../controllers/requests/fetchRequestsController');

const buildRes = () => {
  const res = {};
  res.json = jest.fn(() => res);
  return res;
};

describe('fetchRequestsController.getApprovalHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('ignores blank optional filters sent by the approval history page', async () => {
    const req = {
      query: { status: '', from_date: '', to_date: '', department_id: '' },
      user: { id: 7, institute_id: 3 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [7, 3]);
    expect(pool.query.mock.calls[0][0]).not.toContain("AND r.department_id = $");
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('only adds department and date filters when they are valid values', async () => {
    const req = {
      query: { department_id: '4', from_date: '2026-06-01', to_date: 'bad-date' },
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('r.department_id = $2'), [7, 4, '2026-06-01']);
    expect(pool.query.mock.calls[0][0]).toContain('a.approved_at >= $3');
    expect(pool.query.mock.calls[0][0]).not.toContain('a.approved_at <=');
  });
});