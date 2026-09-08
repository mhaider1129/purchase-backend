jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');
const updateItemProcurementStatus = require('../controllers/requestedItems/updateProcurementStatusController');

const buildResponse = () => ({
  json: jest.fn(),
});

const buildRequest = (body) => ({
  params: { item_id: '42' },
  body,
  user: {
    id: 7,
    hasPermission: jest.fn((permission) => permission === 'procurement.update-status'),
  },
});

describe('updateItemProcurementStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows procurement users to manually close a partially procured item as completed', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 42, procurement_status: 'completed' }],
      })
      .mockResolvedValueOnce({});

    const req = buildRequest({
      procurement_status: ' completed ',
      procurement_comment: 'Partial quantity accepted; remaining quantity will not be purchased.',
    });
    const res = buildResponse();
    const next = jest.fn();

    await updateItemProcurementStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SET procurement_status = $1'),
      [
        'completed',
        'Partial quantity accepted; remaining quantity will not be purchased.',
        7,
        '42',
      ],
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'Procurement status updated',
      item: { id: 42, procurement_status: 'completed' },
    });
  });

  it('accepts the not_procured terminal status used to unblock request completion', async () => {
    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 42, procurement_status: 'not_procured' }],
      })
      .mockResolvedValueOnce({});

    const req = buildRequest({ status: 'not_procured', comment: 'No supplier can fulfill the balance.' });
    const res = buildResponse();
    const next = jest.fn();

    await updateItemProcurementStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      ['not_procured', 'No supplier can fulfill the balance.', 7, '42'],
    );
  });

  it('does not allow a rejected item procurement status to be changed', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ approval_status: 'Rejected' }] });

    const req = buildRequest({ status: 'pending', comment: '' });
    const res = buildResponse();
    const next = jest.fn();

    await updateItemProcurementStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: 'Cannot change procurement status for a rejected item',
    }));
    expect(res.json).not.toHaveBeenCalled();
  });
});