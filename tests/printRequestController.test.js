jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn().mockResolvedValue());

const pool = require('../config/db');
const { printRequest } = require('../controllers/requests/printRequestController');

const buildRequest = (query = {}) => ({
  params: { id: '42' },
  query,
  user: { id: 7 },
});

const buildResponse = () => ({
  json: jest.fn(),
});

const requestRow = {
  id: 42,
  requester_id: 7,
  assigned_to: null,
  request_type: 'Non-Stock',
  print_count: 3,
  department_name: 'Operations',
  requester_name: 'Requester User',
  requester_role: 'Requester',
};

describe('printRequestController.printRequest', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('increments the print count by default', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...requestRow }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...requestRow, print_count: 4 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = buildResponse();
    const next = jest.fn();

    await printRequest(buildRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE requests SET print_count = $1'),
      [4, '42']
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Request printed for the 4th time',
      print_count: 4,
    }));
  });

  it('does not increment the print count when requested', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...requestRow }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = buildResponse();
    const next = jest.fn();

    await printRequest(buildRequest({ incrementPrintCount: 'false' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query.mock.calls).not.toEqual(
      expect.arrayContaining([
        [expect.stringContaining('UPDATE requests SET print_count = $1'), expect.any(Array)],
      ])
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Request ready for printing.',
      print_count: 3,
    }));
  });
});