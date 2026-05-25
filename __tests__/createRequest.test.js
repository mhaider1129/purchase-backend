jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/notificationService', () => ({ createNotifications: jest.fn() }));
jest.mock('../controllers/utils/approvalRoutes', () => ({ fetchApprovalRoutes: jest.fn() }));
jest.mock('../controllers/requests/saveRequestAttachments', () => ({ persistRequestAttachments: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureWarehouseInventoryTables', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureProjectsTable', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureFinanceCoreTables', () => ({ ensureFinanceCoreTables: jest.fn(() => Promise.resolve()) }));
jest.mock('../services/financeCoreService', () => ({
  assertBudgetCanCover: jest.fn(() => Promise.resolve({ envelope: { id: 1 } })),
  recordCommitment: jest.fn(() => Promise.resolve()),
}));

const pool = require('../config/db');
const { fetchApprovalRoutes } = require('../controllers/utils/approvalRoutes');
const { createRequest } = require('../controllers/requests/createRequestController');

const createMockRes = () => { const res = {}; res.status = jest.fn(() => res); res.json = jest.fn(() => res); return res; };

describe('createRequest controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects invalid items payload string', async () => {
    const req = { body: { request_type: 'Non-Stock', justification: 'Need item', items: 'not-json' }, user: { id: 1, role: 'Requester', department_id: 10, institute_id: 1 } };
    const next = jest.fn();
    await createRequest(req, createMockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'Invalid items payload' }));
  });

  test('rejects missing item name', async () => {
    const req = { body: { request_type: 'Non-Stock', justification: 'Need item', items: [{ quantity: 1 }] }, user: { id: 1, role: 'Requester', department_id: 10, institute_id: 1 } };
    const next = jest.fn();
    await createRequest(req, createMockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'Item 1 is missing a valid name' }));
  });

  test('rejects non-integer quantity', async () => {
    const req = { body: { request_type: 'Non-Stock', justification: 'Need item', items: [{ item_name: 'Gloves', quantity: 1.5 }] }, user: { id: 1, role: 'Requester', department_id: 10, institute_id: 1 } };
    const next = jest.fn();
    await createRequest(req, createMockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'Item 1 quantity must be a whole number without decimals' }));
  });

  test('creates non-stock request successfully with approval routing', async () => {
    const mockClient = { query: jest.fn(), release: jest.fn() };
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    pool.connect.mockResolvedValueOnce(mockClient);

    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ type: 'medical', institute_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 100, request_type: 'Non-Stock', temporary_requester_name: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 200 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, email: 'hod@example.com' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ approval_level: 1, approver_id: 2, approver_name: 'HOD User', approver_role: 'HOD', approver_email: 'hod@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: 200, item_name: 'Gloves', quantity: 10, purchased_quantity: 0 }] })
      .mockResolvedValueOnce({});

    fetchApprovalRoutes.mockResolvedValueOnce([{ role: 'HOD', approval_level: 1 }]);

    const req = { body: { request_type: 'Non-Stock', justification: 'Need item', items: [{ item_name: 'Gloves', quantity: 10, unit_cost: 5 }] }, user: { id: 1, role: 'Requester', department_id: 10, institute_id: 1 }, files: [] };
    const res = createMockRes();
    const next = jest.fn();

    await createRequest(req, res, next);

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ request_id: 100, request_type: 'Non-Stock', estimated_cost: 50 }));
    expect(next).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });
});