jest.mock('../config/db', () => ({}));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/notificationService', () => ({ createNotifications: jest.fn() }));
jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn());
jest.mock('../utils/ensureWarehouseInventoryTables', () => jest.fn());
jest.mock('../utils/ensureProjectsTable', () => jest.fn());
jest.mock('../utils/ensureRequestSchedulingColumns', () => jest.fn());
jest.mock('../utils/ensureRequestClientSubmissionKey', () => jest.fn());
jest.mock('../utils/ensureMaintenanceRequestSchema', () => jest.fn());
jest.mock('../utils/ensureFinanceCoreTables', () => ({ ensureFinanceCoreTables: jest.fn() }));
jest.mock('../services/financeCoreService', () => ({
  evaluateBudgetCoverage: jest.fn(),
  recordCommitment: jest.fn(),
}));
jest.mock('../controllers/utils/approvalRoutes', () => ({ fetchApprovalRoutes: jest.fn() }));
jest.mock('../controllers/requests/saveRequestAttachments', () => ({
  persistRequestAttachments: jest.fn(),
}));

const { assignApprover } = require('../controllers/requests/createRequestController');

describe('assignApprover', () => {
  it('assigns Medical Devices approvers globally instead of limiting them to requester department', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 46, email: 'medical.devices@example.com' }] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({});

    await assignApprover(
      client,
      'Medical Devices',
      12,
      311,
      'Medical Device',
      3,
      'medical',
    );

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1',
      ['Medical Devices'],
    );
    expect(client.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO approvals'),
      [311, 46, 3, false, 'Pending', null],
    );
  });

  it('skips later approval levels when the same approver already approved the request', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 12, email: 'hod@example.com' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await assignApprover(
      client,
      'HOD',
      5,
      340,
      'Maintenance',
      2,
      'operational',
    );

    expect(result).toEqual({ skipped: true, reason: 'duplicate_approver' });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO approvals'),
      expect.any(Array),
    );
  });
});