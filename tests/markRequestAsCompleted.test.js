jest.mock('../config/db', () => ({
  connect: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/notificationService', () => ({
  createNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/technicalInspectionStatus', () => ({
  getInspectionSummaryForRequest: jest.fn().mockResolvedValue({
    totalCount: 0,
    pendingCount: 0,
  }),
}));

jest.mock('../controllers/requests/createRequestController', () => ({
  assignApprover: jest.fn(),
}));

const pool = require('../config/db');
const { createNotifications } = require('../utils/notificationService');
const { sendEmail } = require('../utils/emailService');
const { markRequestAsCompleted } = require('../controllers/requests/updateRequestsController');

const buildResponse = () => ({
  json: jest.fn(),
});

const buildRequest = () => ({
  params: { id: '124' },
  user: {
    id: 7,
    hasPermission: jest.fn((permission) => permission === 'requests.manage'),
  },
});

describe('markRequestAsCompleted', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();

    client = {
      query: jest.fn(),
      release: jest.fn(),
    };

    pool.connect.mockResolvedValue(client);
  });

  it('treats explicitly skipped item statuses as finalized when validating completion', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ missing_required: 0, invalid_status: 0 }],
      }) // requested item status summary
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            request_type: 'Purchase',
            department_id: 3,
            requester_id: 11,
            initiated_by_technician_id: null,
          },
        ],
      }) // request row
      .mockResolvedValueOnce({ rows: [{ id: 11, email: 'requester@example.com' }] })
      .mockResolvedValueOnce({}) // update requests
      .mockResolvedValueOnce({}) // insert request log
      .mockResolvedValueOnce({}); // COMMIT

    const req = buildRequest();
    const res = buildResponse();
    const next = jest.fn();

    await markRequestAsCompleted(req, res, next);

    const statusSummarySql = client.query.mock.calls[1][0];
    expect(statusSummarySql).toContain("'not_procured'");
    expect(statusSummarySql).toContain("'canceled'");
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      message: '✅ Request marked as completed',
      status: 'completed',
    });
    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 11,
          metadata: expect.objectContaining({ action: 'request_completed' }),
        }),
      ]),
      client,
    );
    expect(sendEmail).toHaveBeenCalledWith(
      'requester@example.com',
      'Request 124 completed',
      expect.stringContaining('marked as completed'),
    );
    expect(client.release).toHaveBeenCalled();
  });

  it('returns a clear validation error when an item status is still pending', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ missing_required: 0, invalid_status: 1 }],
      })
      .mockResolvedValueOnce({}); // ROLLBACK

    const req = buildRequest();
    const res = buildResponse();
    const next = jest.fn();

    await markRequestAsCompleted(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message:
          'All items must be purchased, completed, not procured, or canceled before marking the request as completed.',
      }),
    );
    expect(res.json).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});