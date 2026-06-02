jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/notificationService', () => ({ createNotifications: jest.fn() }));
jest.mock('../controllers/utils/approvalRoutes', () => ({ fetchApprovalRoutes: jest.fn() }));
jest.mock('../controllers/requests/saveRequestAttachments', () => ({ persistRequestAttachments: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureWarehouseInventoryTables', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureProjectsTable', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureRequestClientSubmissionKey', () => jest.fn(() => Promise.resolve()));
jest.mock('../utils/ensureRequestSchedulingColumns', () => jest.fn(() => Promise.resolve()));
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

  test('returns existing request for duplicate client submission key', async () => {
    const duplicateSubmissionError = new Error('duplicate key value violates unique constraint');
    duplicateSubmissionError.code = '23505';
    duplicateSubmissionError.constraint = 'requests_client_submission_key_unique_idx';

    const mockClient = { query: jest.fn(), release: jest.fn() };
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 100,
            request_type: 'Non-Stock',
            estimated_cost: 50,
            status: 'Submitted',
            scheduled_for: null,
            created_at: '2026-06-02T12:00:00.000Z',
          },
        ],
      });
    pool.connect.mockResolvedValueOnce(mockClient);

    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ type: 'medical', institute_id: 1 }] })
      .mockRejectedValueOnce(duplicateSubmissionError)
      .mockResolvedValueOnce({});

    const req = {
      body: {
        request_type: 'Non-Stock',
        justification: 'Need item',
        client_submission_key: 'repeat-submit-key',
        items: [{ item_name: 'Gloves', quantity: 10, unit_cost: 5 }],
      },
      user: { id: 1, role: 'Requester', department_id: 10, institute_id: 1 },
      files: [],
    };
    const res = createMockRes();
    const next = jest.fn();

    await createRequest(req, res, next);

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 100,
        request_type: 'Non-Stock',
        duplicate_submission: true,
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
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

  test('treats string null target section as no section when creating stock request', async () => {
    const mockClient = { query: jest.fn(), release: jest.fn() };
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    pool.connect.mockResolvedValueOnce(mockClient);

    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ type: 'operational', institute_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101, request_type: 'Stock', scheduled_for: null, temporary_requester_name: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 201 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 201, item_name: 'Gloves', quantity: 3, purchased_quantity: 0 }] })
      .mockResolvedValueOnce({});

    fetchApprovalRoutes.mockResolvedValueOnce([]);

    const req = {
      body: {
        request_type: 'Stock',
        justification: 'Need stock',
        target_section_id: 'null',
        items: [{ item_name: 'Gloves', quantity: 3 }],
      },
      user: {
        id: 1,
        role: 'WarehouseStaff',
        department_id: 10,
        institute_id: 1,
        warehouse_id: 5,
        section_id: null,
      },
      files: [],
    };
    const res = createMockRes();
    const next = jest.fn();

    await createRequest(req, res, next);

    const insertRequestCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO requests'),
    );
    expect(insertRequestCall[1][4]).toBeNull();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

});