jest.mock('../config/db', () => ({
  connect: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/notificationService', () => ({
  createNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../controllers/requests/createRequestController', () => ({
  assignApprover: jest.fn(),
}));

jest.mock('../controllers/utils/approvalRoutes', () => ({
  fetchApprovalRoutes: jest.fn().mockResolvedValue([]),
  resolveRouteDomain: jest.fn().mockResolvedValue('clinical'),
}));

jest.mock('../services/requestAutoAssignmentService', () => ({
  applyAutoAssignmentForApprovedRequest: jest.fn().mockResolvedValue(null),
}));

const pool = require('../config/db');
const { applyAutoAssignmentForApprovedRequest } = require('../services/requestAutoAssignmentService');
const { updateApprovalStatus } = require('../controllers/requests/updateRequestsController');

describe('updateApprovalStatus', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();

    client = {
      query: jest.fn(),
      release: jest.fn(),
    };

    pool.connect.mockResolvedValue(client);
  });

  it('does not downgrade a procurement-completed request to approved on final approval', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 55, request_id: 124, approval_level: 2 }],
      }) // active approval
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            request_type: 'Purchase',
            department_id: 3,
            request_domain: 'clinical',
            estimated_cost: 150,
            is_urgent: false,
            requester_id: 11,
            status: 'completed',
          },
        ],
      }) // request row
      .mockResolvedValueOnce({}) // update approvals
      .mockResolvedValueOnce({}) // insert request log
      .mockResolvedValueOnce({ rows: [] }) // fallback existing approval lookup
      .mockResolvedValueOnce({ rows: [] }) // next pending approvals
      .mockResolvedValueOnce({ rowCount: 2 }) // auto-approve requested items
      .mockResolvedValueOnce({}) // request_logs items auto-approved
      .mockResolvedValueOnce({}) // approval_logs items auto-approved
      .mockResolvedValueOnce({}); // COMMIT

    const req = {
      params: { id: '55' },
      body: { status: 'Approved', comments: 'Looks good' },
      user: {
        id: 7,
        hasPermission: jest.fn(() => true),
      },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateApprovalStatus(req, res, next);

    const finalStatusUpdate = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'Approved'"),
    );

    expect(finalStatusUpdate).toBeDefined();
    expect(finalStatusUpdate[0]).toContain("<> 'completed'");
    expect(finalStatusUpdate[1]).toEqual([124]);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: '✅ Request approved successfully' });
    expect(applyAutoAssignmentForApprovedRequest).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('applies the configured auto-assignment after the final approval', async () => {
    client.query.mockImplementation(async (sql) => {
      const statement = String(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return {};
      if (statement.includes('SELECT id, request_id, approval_level')) {
        return { rowCount: 1, rows: [{ id: 55, request_id: 124, approval_level: 2 }] };
      }
      if (statement.includes('FROM requests') && statement.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{
          request_type: 'Stock', department_id: 3, request_domain: 'clinical',
          estimated_cost: 150, is_urgent: false, requester_id: 11,
          status: 'Pending Approval', supply_warehouse_id: 9, assigned_to: null,
        }] };
      }
      if (statement.includes('SELECT 1 FROM approvals')) return { rowCount: 1, rows: [{}] };
      if (statement.includes('SELECT id') && statement.includes("status = 'Pending'")) {
        return { rows: [] };
      }
      if (statement.includes('UPDATE public.requested_items')) return { rowCount: 0 };
      return { rowCount: 1, rows: [] };
    });

    const req = {
      params: { id: '55' }, body: { status: 'Approved' },
      user: { id: 7, hasPermission: jest.fn(() => true) },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateApprovalStatus(req, res, next);

    expect(applyAutoAssignmentForApprovedRequest).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        id: 124,
        request_type: 'Stock',
        supply_warehouse_id: 9,
        assigned_to: null,
      }),
      7,
    );
    expect(client.query.mock.calls.findIndex(([sql]) => String(sql).includes("SET status = 'Approved'")))
      .toBeLessThan(client.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT'));
    expect(next).not.toHaveBeenCalled();
  });

  it('only advances pending approvals from the active reclassified route', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return {};
      if (String(sql).includes('SELECT id, request_id, approval_level')) {
        return { rowCount: 1, rows: [{
          id: 3452, request_id: 124, approval_level: 3,
          approval_route_version: 2, route_snapshot_id: 'it-route-v2',
        }] };
      }
      if (String(sql).includes('FROM requests') && String(sql).includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{
          request_type: 'IT Item', department_id: 3, request_domain: 'it',
          estimated_cost: 150, is_urgent: false, requester_id: 11,
          status: 'Pending Approval',
        }] };
      }
      if (String(sql).includes('SELECT 1 FROM approvals')) return { rowCount: 1, rows: [{}] };
      if (String(sql).includes('SELECT id') && String(sql).includes("status = 'Pending'")) {
        return { rows: [{ id: 3453 }] };
      }
      if (String(sql).includes('activePendingApprovals')) return { rows: [] };
      return { rowCount: 1, rows: [] };
    });

    const req = {
      params: { id: '3452' }, body: { status: 'Approved' },
      user: { id: 7, hasPermission: jest.fn(() => true) },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();
    await updateApprovalStatus(req, res, next);

    const nextLookup = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT id') && String(sql).includes("status = 'Pending'"),
    );
    expect(nextLookup[0]).toContain('COALESCE(is_superseded, FALSE) = FALSE');
    expect(nextLookup[0]).toContain('approval_route_version IS NOT DISTINCT FROM $2::integer');
    expect(nextLookup[0]).toContain('route_snapshot_id IS NOT DISTINCT FROM $3::text');
    expect(nextLookup[1]).toEqual([124, 2, 'it-route-v2']);

    const activation = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE approvals SET is_active = true'),
    );
    expect(activation[0]).toContain('COALESCE(is_superseded, FALSE) = FALSE');
    expect(activation[1]).toEqual([124, 3453, 2, 'it-route-v2']);
    expect(next).not.toHaveBeenCalled();
  });

  it('rolls back before returning an inactive-approver error', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // active approval
      .mockResolvedValueOnce({}); // ROLLBACK

    const req = {
      params: { id: '3452' },
      body: { status: 'Approved' },
      user: { id: 7, hasPermission: jest.fn(() => true) },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateApprovalStatus(req, res, next);

    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'You are not the active approver for this request',
    }));
    expect(res.json).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('preserves database errors so the global handler can classify them', async () => {
    const databaseError = Object.assign(new Error('approval log constraint failed'), {
      code: '23514',
    });
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(databaseError) // active approval query
      .mockResolvedValueOnce({}); // ROLLBACK

    const req = {
      params: { id: '3452' },
      body: { status: 'Approved' },
      user: { id: 7, hasPermission: jest.fn(() => true) },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateApprovalStatus(req, res, next);

    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(next).toHaveBeenCalledWith(databaseError);
    expect(client.release).toHaveBeenCalled();
  });

  it('forwards connection failures without trying to release a missing client', async () => {
    const connectionError = new Error('database unavailable');
    pool.connect.mockRejectedValueOnce(connectionError);

    const req = {
      params: { id: '3452' },
      body: { status: 'Approved' },
      user: { id: 7, hasPermission: jest.fn(() => true) },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateApprovalStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(connectionError);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });
});