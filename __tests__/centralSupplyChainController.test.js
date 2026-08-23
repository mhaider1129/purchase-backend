jest.mock('../config/db', () => ({ query: jest.fn() }));

jest.mock('../utils/ensureCentralSupplyChainTrackingColumns', () => jest.fn());

const pool = require('../config/db');
const ensureCentralSupplyChainTrackingColumns = require('../utils/ensureCentralSupplyChainTrackingColumns');
const { updateCentralSupplyChainStatus } = require('../controllers/requests/centralSupplyChainController');

const request = (overrides = {}) => ({
  params: { id: '42' },
  body: { sent: true },
  user: {
    id: 7,
    institute_id: 3,
    hasPermission: jest.fn(() => true),
  },
  ...overrides,
});

describe('Central Supply Chain status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureCentralSupplyChainTrackingColumns.mockResolvedValue();
  });

  test('records the authenticated user when marking a request as sent', async () => {
    const row = {
      id: 42,
      sent_to_central_supply_at: '2026-08-21T10:00:00.000Z',
      sent_to_central_supply_by: 7,
    };
    pool.query.mockResolvedValue({ rowCount: 1, rows: [row] });
    const req = request();
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateCentralSupplyChainStatus(req, res, next);

    expect(ensureCentralSupplyChainTrackingColumns).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.requests'),
      [true, 7, 42, 3],
    );
    expect(res.json).toHaveBeenCalledWith(row);
    expect(next).not.toHaveBeenCalled();
  });

  test('clears both tracking values when marking a request as not sent', async () => {
    pool.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 42, sent_to_central_supply_at: null, sent_to_central_supply_by: null }],
    });
    const req = request({
      params: { id: '42' },
      body: { sent: false },
      user: { id: 7, institute_id: null, hasPermission: jest.fn(() => true) },
    });
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateCentralSupplyChainStatus(req, res, next);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [false, 7, 42, null]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      sent_to_central_supply_at: null,
      sent_to_central_supply_by: null,
    }));
  });
});