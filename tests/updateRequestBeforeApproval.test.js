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
  resolveRouteDomain: jest.fn().mockResolvedValue('operational'),
}));

jest.mock('../utils/ensureRequestEditApprovalsTable', () => jest.fn().mockResolvedValue(undefined));

const pool = require('../config/db');
const ensureRequestEditApprovalsTable = require('../utils/ensureRequestEditApprovalsTable');
const { updateRequestBeforeApproval } = require('../controllers/requests/updateRequestsController');

describe('updateRequestBeforeApproval', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';

    client = {
      query: jest.fn(),
      release: jest.fn(),
    };

    pool.connect.mockResolvedValue(client);
  });

  it('falls back to any active SCM user when a maintenance edit department has no SCM reviewer', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 63,
            requester_id: 22,
            initiated_by_technician_id: 7,
            status: 'Submitted',
            request_type: 'Maintenance',
            department_id: 4,
            section_id: 9,
            request_domain: 'operational',
            temporary_requester_name: null,
            project_id: null,
            supply_warehouse_id: null,
            justification: 'Original justification',
          },
        ],
      }) // request lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 4 }] }) // department check
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9 }] }) // section check
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] }) // SCM lookup
      .mockResolvedValueOnce({}) // deactivate previous edit approval rows
      .mockResolvedValueOnce({}) // supersede previous edit approval requests
      .mockResolvedValueOnce({ rows: [{ id: 1234 }] }) // insert approval
      .mockResolvedValueOnce({}) // insert request edit approval
      .mockResolvedValueOnce({}) // insert request log
      .mockResolvedValueOnce({}); // COMMIT

    const req = {
      params: { id: '63' },
      body: {
        justification: 'Updated justification',
        department_id: 4,
        section_id: 9,
        items: [{ item_name: 'Filter', quantity: 2, unit_cost: 10 }],
      },
      user: { id: 7 },
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await updateRequestBeforeApproval(req, res, next);

    const scmLookup = client.query.mock.calls.find(([sql]) => String(sql).includes("UPPER(role) = 'SCM'"));
    expect(scmLookup).toBeDefined();
    expect(scmLookup[0]).not.toContain('AND ($1::INT IS NULL OR department_id = $1)');
    expect(scmLookup[0]).toContain('WHEN $1::INT IS NOT NULL AND department_id = $1 THEN 0');
    expect(scmLookup[1]).toEqual([4]);
    expect(ensureRequestEditApprovalsTable).toHaveBeenCalledWith(client);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ pending_edit_approval: true }));
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});