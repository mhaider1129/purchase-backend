jest.mock('../config/db', () => ({
  connect: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ accepted: ['approver@example.com'] }),
  buildApprovalActionLinks: jest.fn(() => ({
    approveUrl: 'https://app.example.com/approve',
    rejectUrl: 'https://app.example.com/reject',
  })),
  verifyApprovalActionToken: jest.fn(),
}));

jest.mock('../utils/ensureApprovalReminderColumn', () => jest.fn().mockResolvedValue());

const pool = require('../config/db');
const { sendEmail, buildApprovalActionLinks } = require('../utils/emailService');
const ensureApprovalReminderColumn = require('../utils/ensureApprovalReminderColumn');
const { notifyCurrentApprovalByEmail } = require('../controllers/approvalsController');

const buildRes = () => {
  const res = {};
  res.json = jest.fn(() => res);
  return res;
};

const buildClient = (approvalRow) => {
  const client = {
    query: jest.fn((sql) => {
      const statement = String(sql);
      if (statement.includes('SELECT') && statement.includes('FROM approvals a')) {
        return Promise.resolve({ rows: approvalRow ? [approvalRow] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
};

describe('notifyCurrentApprovalByEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emails the current active approver and records reminder audit entries', async () => {
    const client = buildClient({
      approval_id: 12,
      request_id: 44,
      approver_id: 8,
      approval_level: 2,
      approval_status: 'Pending',
      approver_email: 'approver@example.com',
      approver_name: 'Approver User',
      request_type: 'Stock',
      requester_id: 7,
      assigned_to: null,
      request_status: 'Submitted',
    });

    const req = {
      params: { request_id: '44' },
      user: { id: 5, name: 'SCM User', role: 'SCM', hasPermission: jest.fn(() => false) },
    };
    const res = buildRes();
    const next = jest.fn();

    await notifyCurrentApprovalByEmail(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ensureApprovalReminderColumn).toHaveBeenCalledWith(client);
    expect(buildApprovalActionLinks).toHaveBeenCalledWith({ approvalId: 12, approverId: 8 });
    expect(sendEmail).toHaveBeenCalledWith(
      'approver@example.com',
      'Reminder: request 44 is waiting for your approval',
      expect.stringContaining('SCM User sent you a reminder to review Stock request 44.'),
    );
    expect(sendEmail.mock.calls[0][2]).toContain('Approve: https://app.example.com/approve');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE approvals'), [12]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('Approval reminder emailed'), [44, 5, 'Reminder sent to approval level 2']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('Reminder Sent'), [12, 44, 5, 'Email reminder sent to approver@example.com']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(res.json).toHaveBeenCalledWith({
      message: 'Approval reminder email sent successfully',
      request_id: 44,
      approval_id: 12,
      approver_id: 8,
      approval_level: 2,
    });
  });

  it('rejects reminders when the current approver has no email address', async () => {
    const client = buildClient({
      approval_id: 12,
      request_id: 44,
      approver_id: 8,
      approval_level: 2,
      approval_status: 'Pending',
      approver_email: null,
      approver_name: 'Approver User',
      request_type: 'Stock',
      requester_id: 7,
      assigned_to: null,
      request_status: 'Submitted',
    });

    const req = {
      params: { request_id: '44' },
      user: { id: 5, role: 'SCM', hasPermission: jest.fn(() => false) },
    };
    const res = buildRes();
    const next = jest.fn();

    await notifyCurrentApprovalByEmail(req, res, next);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'The current approver does not have an email address' }));
  });

  it('rejects reminders from non-SCM users even when they own the request', async () => {
    const client = buildClient({
      approval_id: 12,
      request_id: 44,
      approver_id: 8,
      approval_level: 2,
      approval_status: 'Pending',
      approver_email: 'approver@example.com',
      approver_name: 'Approver User',
      request_type: 'Stock',
      requester_id: 7,
      assigned_to: null,
      request_status: 'Submitted',
    });

    const req = {
      params: { request_id: '44' },
      user: { id: 7, name: 'Requester User', role: 'Requester', hasPermission: jest.fn(() => true) },
    };
    const res = buildRes();
    const next = jest.fn();

    await notifyCurrentApprovalByEmail(req, res, next);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, message: 'Only SCM users can remind the current approver' }));
  });

});