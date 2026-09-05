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

const pool = require('../config/db');
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
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
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