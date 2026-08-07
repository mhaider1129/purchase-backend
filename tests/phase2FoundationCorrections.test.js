const requestPolicy = require('../policies/requestPolicy');
const approvalPolicy = require('../policies/approvalPolicy');
const auditService = require('../services/auditService');
const { enqueueNotification, keyFor } = require('../services/notificationOutboxService');
const errorHandler = require('../middleware/errorHandler');

describe('Phase 2 foundation corrections', () => {
  const request = { id: 3, requester_id: 2, institute_id: 1, department_id: 2, section_id: 3, warehouse_id: 4 };
  test.each(['institute_id', 'department_id', 'section_id'])('missing actor %s fails closed', async field => {
    const actor = { id: 2, institute_id: 1, department_id: 2, section_id: 3, permissions: ['requests.manage'] }; delete actor[field];
    await expect(requestPolicy.assertCanTransition({ actor, request })).rejects.toMatchObject({ statusCode: 403 });
  });
  test('explicit cross-scope permissions permit an exception', async () => {
    const actor = { id: 2, permissions: ['requests.manage', 'requests.cross-institute', 'requests.cross-department', 'requests.cross-section'] };
    await expect(requestPolicy.assertCanTransition({ actor, request })).resolves.toBe(true);
  });
  test('missing warehouse scope fails closed for approvals', async () => {
    const actor = { id: 9, institute_id: 1, department_id: 2, section_id: 3 };
    await expect(approvalPolicy.assertCanDecide({ actor, request, approval: { approver_id: 9 } })).rejects.toMatchObject({ code: 'DATA_SCOPE_DENIED', statusCode: 403 });
  });
  test('audit keeps request and correlation identifiers separate', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{}] });
    await auditService.writeAuditEvent({ entityType: 'request', entityId: 3, action: 'x', requestId: null, correlationId: 'trace-1', client: { query } });
    expect(JSON.parse(query.mock.calls[0][1][5])).toMatchObject({ requestId: null, correlationId: 'trace-1' });
  });
  test('outbox duplicate safely returns the existing event', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 7 }] });
    await expect(enqueueNotification({ query }, { type: 'x', entityType: 'request', entityId: 3, idempotencyKey: 'event-3' })).resolves.toEqual({ event: { id: 7 }, created: false });
    expect(query.mock.calls[0][0]).toContain('DO NOTHING'); expect(query.mock.calls[0][0]).not.toContain('DO UPDATE');
  });
  test('outbox requires deterministic event identity', () => expect(() => keyFor({ type: 'x', entityType: 'request', entityId: 3 })).toThrow(expect.objectContaining({ code: 'OUTBOX_IDEMPOTENCY_KEY_REQUIRED' })));
  test('middleware honors statusCode and stable code', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler(Object.assign(new Error('denied'), { statusCode: 403, code: 'SCOPE_DENIED' }), { originalUrl: '/x', method: 'POST' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SCOPE_DENIED' }));
  });
});