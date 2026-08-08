const requestPolicy = require('../policies/requestPolicy');
const approvalPolicy = require('../policies/approvalPolicy');
const auditService = require('../services/auditService');
const { enqueueNotification, keyFor } = require('../services/notificationOutboxService');
const errorHandler = require('../middleware/errorHandler');
const fs = require('fs');
const path = require('path');
const { createApprovalEngine } = require('../services/approvalEngine');

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
  test('an unscoped resource section does not restrict access', async () => {
    const actor = { id: 2, institute_id: 1, department_id: 2, section_id: null, permissions: ['requests.manage'] };
    await expect(requestPolicy.assertCanTransition({ actor, request: { ...request, section_id: null } })).resolves.toBe(true);
  });
  test('a missing actor section fails closed for a scoped resource', async () => {
    const actor = { id: 2, institute_id: 1, department_id: 2, section_id: null, permissions: ['requests.manage'] };
    await expect(requestPolicy.assertCanTransition({ actor, request })).rejects.toMatchObject({ code: 'SECTION_SCOPE_DENIED' });
  });
  test('strict permission prevents requester ownership from authorizing reclassification', async () => {
    const actor = { id: request.requester_id, institute_id: 1, department_id: 2, section_id: 3, permissions: [] };
    await expect(requestPolicy.assertCanTransition({ actor, request, permission: 'requests.reclassify', requireExplicitPermission: true })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  test('reclassification permission authorizes an in-scope user', async () => {
    const actor = { id: 8, institute_id: 1, department_id: 2, section_id: 3, permissions: ['requests.reclassify'] };
    await expect(requestPolicy.assertCanTransition({ actor, request, permission: 'requests.reclassify', requireExplicitPermission: true })).resolves.toBe(true);
  });
  test('reclassification still requires cross-institute permission', async () => {
    const actor = { id: 8, institute_id: 99, department_id: 2, section_id: 3, permissions: ['requests.reclassify'] };
    await expect(requestPolicy.assertCanTransition({ actor, request, permission: 'requests.reclassify', requireExplicitPermission: true })).rejects.toMatchObject({ code: 'INSTITUTE_SCOPE_DENIED' });
  });
  test('corrected request reclassification service imports', () => {
    expect(require('../services/requestReclassificationService').reclassifyRequest).toEqual(expect.any(Function));
  });
  test('manual SQL enforces versioned approval-member identity without forbidding parallel active members', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/003_request_reclassification_and_uom.sql'), 'utf8');
    expect(sql).not.toContain('uq_approvals_one_active_current_pending');
    expect(sql).not.toMatch(/SET approval_route_version = 1/);
    expect(sql).not.toMatch(/approval_route_version SET NOT NULL/);
    expect(sql).toMatch(/GROUP BY request_id, approval_route_version, approval_level, approver_id/);
    expect(sql).toMatch(/ON public\.approvals \(request_id, approval_route_version, approval_level, approver_id\)/);
    expect(sql).toMatch(/ALTER TABLE public\.requests\s+ADD COLUMN IF NOT EXISTS approval_route_snapshot JSONB,\s+ADD COLUMN IF NOT EXISTS approval_route_snapshot_id TEXT/);
    expect(sql).toMatch(/table_name = 'requests'[\s\S]*column_name IN \('approval_route_snapshot', 'approval_route_snapshot_id'\)/);
  });
  test('activateNext activates the entire first current level', async () => {
    const repository = {
      getCurrentLevel: jest.fn().mockResolvedValue(2),
      activateLevel: jest.fn().mockResolvedValue([{ id: 12, approver_id: 4, approval_route_version: 3 }, { id: 13, approver_id: 5, approval_route_version: 3 }]),
    };
    const notify = jest.fn();
    await expect(createApprovalEngine({ repository, notify }).activateNext({}, 3, { approvalRouteVersion: 3 })).resolves.toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  test('superseded approvals cannot be decided', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 5, request_id: 3, status: 'Pending', is_active: true, is_superseded: true }] }) };
    await expect(createApprovalEngine().decide({ approvalId: 5, decision: 'Approved', actor: { id: 8 } }, client)).rejects.toMatchObject({ code: 'APPROVAL_SUPERSEDED' });
  });
  test('superseded approvals cannot be reassigned', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 5, status: 'Pending', is_superseded: true }] }) };
    await expect(createApprovalEngine().reassign({ approvalId: 5, newApproverId: 9, actor: { id: 8 }, reason: 'coverage' }, client)).rejects.toMatchObject({ code: 'APPROVAL_SUPERSEDED' });
  });
  test('approval history intentionally has no superseded filter', () => {
    const source = fs.readFileSync(path.join(__dirname, '../controllers/approvalsController.js'), 'utf8');
    const historyQuery = source.match(/FROM approvals a[\s\S]*?WHERE a\.request_id = \$1[\s\S]*?ORDER BY a\.approval_level ASC/);
    expect(historyQuery?.[0]).not.toContain('is_superseded');
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