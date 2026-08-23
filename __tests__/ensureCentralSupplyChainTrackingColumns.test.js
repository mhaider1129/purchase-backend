jest.mock('../config/db', () => ({ query: jest.fn() }));

const ensureCentralSupplyChainTrackingColumns = require('../utils/ensureCentralSupplyChainTrackingColumns');

describe('ensureCentralSupplyChainTrackingColumns', () => {
  test('does not require REFERENCES privileges on the users table', async () => {
    const client = { query: jest.fn().mockResolvedValue() };

    await ensureCentralSupplyChainTrackingColumns(client);

    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain('sent_to_central_supply_by INTEGER');
    expect(sql).not.toContain('REFERENCES public.users');
  });
});