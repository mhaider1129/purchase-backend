jest.mock('../config/db', () => ({ connect: jest.fn() }));
jest.mock('../utils/ensureCentralSupplyChainTrackingColumns', () => jest.fn());
jest.mock('../services/auditService', () => ({ writeAuditEvent: jest.fn() }));

const pool = require('../config/db');
const validateSchema = require('../utils/ensureCentralSupplyChainTrackingColumns');
const auditService = require('../services/auditService');
const { updateCentralSupplyChainStatus } = require('../controllers/requests/centralSupplyChainController');

const request = (overrides = {}) => ({ params: { id: '42' }, body: { sent: true },
  user: { id: 7, institute_id: 3, hasPermission: jest.fn(() => true) }, ...overrides });

const harness = ({ sent = true, instituteId = 3 } = {}) => {
  const before = { id: 42, institute_id: instituteId, sent_to_central_supply_at: null, sent_to_central_supply_by: null };
  const after = { ...before, sent_to_central_supply_at: sent ? '2026-08-21T10:00:00.000Z' : null, sent_to_central_supply_by: sent ? 7 : null };
  const client = { release: jest.fn(), query: jest.fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rowCount: 1, rows: [before] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [after] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({}) };
  pool.connect.mockResolvedValue(client);
  return { client, before, after };
};

describe('Central Supply Chain status', () => {
  beforeEach(() => { jest.clearAllMocks(); validateSchema.mockResolvedValue(); auditService.writeAuditEvent.mockResolvedValue({}); });

  test.each([[true], [false]])('sets sent=%s with authenticated actor and atomic audit', async (sent) => {
    const h = harness({ sent });
    const req = request({ body: { sent } });
    const res = { json: jest.fn() }; const next = jest.fn();
    await updateCentralSupplyChainStatus(req, res, next);
    expect(h.client.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE public.requests'), [sent, 7, 42]);
    expect(auditService.writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      client: h.client, actorUserId: 7, requestId: 42, beforeData: expect.objectContaining({ sent: false }),
      afterData: expect.objectContaining({ sent, sent_to_central_supply_by: sent ? 7 : null }),
    }));
    expect(h.client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(res.json).toHaveBeenCalledWith(h.after);
  });

  test('keeps institute scope in the locked lookup', async () => {
    const h = harness(); const res = { json: jest.fn() }; const next = jest.fn();
    await updateCentralSupplyChainStatus(request(), res, next);
    expect(h.client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('institute_id = $2'), [42, 3]);
  });

  test('never sends DDL through the controller database client', async () => {
    const h = harness();
    await updateCentralSupplyChainStatus(request(), { json: jest.fn() }, jest.fn());
    expect(h.client.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\b(?:ALTER|CREATE|DROP)\b/i);
  });

  test.each(['42P01', '42703'])('falls back to request_logs when audit_logs has schema error %s', async (code) => {
    const h = harness();
    auditService.writeAuditEvent.mockRejectedValueOnce(Object.assign(new Error('legacy audit schema'), { code }));

    await updateCentralSupplyChainStatus(request(), { json: jest.fn() }, jest.fn());

    expect(h.client.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT central_supply_audit');
    expect(h.client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.request_logs'),
      [42, 'Central Supply Chain status changed', 7, 'Marked as sent to Central Supply Chain'],
    );
    expect(h.client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});