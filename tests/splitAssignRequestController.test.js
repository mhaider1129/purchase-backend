jest.mock('../config/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/notificationService', () => ({
  createNotifications: jest.fn().mockResolvedValue(undefined),
}));

const pool = require('../config/db');
const { createNotifications } = require('../utils/notificationService');
const { splitAssignRequest } = require('../controllers/requests/assignRequestController');

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const buildRequest = (body = {}) => ({
  params: { id: '55' },
  body,
  user: {
    id: 7,
    hasPermission: jest.fn((permission) => permission === 'requests.manage'),
  },
});

describe('splitAssignRequest', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
  });

  it('assigns request items to multiple procurement users in one transaction', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // ensure assignment columns
      .mockResolvedValueOnce({}) // ensure assigned_to index
      .mockResolvedValueOnce({}) // ensure request assignee index
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 55, status: 'Approved', request_type: 'Non-Stock' }],
      }) // request lock
      .mockResolvedValueOnce({
        rows: [
          { id: 10, name: 'Buyer One', email: 'one@example.com', role: 'ProcurementSpecialist' },
          { id: 11, name: 'Buyer Two', email: 'two@example.com', role: 'ProcurementSpecialist' },
        ],
      }) // active users
      .mockResolvedValueOnce({
        rowCount: 3,
        rows: [
          { id: 100, item_name: 'Gloves', approval_status: 'Approved' },
          { id: 101, item_name: 'Masks', approval_status: 'Approved' },
          { id: 102, item_name: 'Gowns', approval_status: 'Approved' },
        ],
      }) // item validation
      .mockResolvedValueOnce({}) // update first user items
      .mockResolvedValueOnce({}) // update second user items
      .mockResolvedValueOnce({}) // clear request-level assignee for split assignment
      .mockResolvedValueOnce({}) // insert log
      .mockResolvedValueOnce({}); // COMMIT

    const req = buildRequest({
      assignments: [
        { user_id: 10, requested_item_ids: [100, 101], notes: 'Urgent line' },
        { user_id: 11, requested_item_ids: [102] },
      ],
    });
    const res = buildResponse();

    await splitAssignRequest(req, res);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('UPDATE requests SET assigned_to = $1 WHERE id = $2', [null, 55]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: '✅ Request split assignment saved successfully',
      data: expect.objectContaining({ request_id: 55, assigned_to: null }),
    }));
    expect(createNotifications).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects duplicate item assignments before opening a transaction', async () => {
    const req = buildRequest({
      assignments: [
        { user_id: 10, requested_item_ids: [100, 101] },
        { user_id: 11, requested_item_ids: [101] },
      ],
    });
    const res = buildResponse();

    await splitAssignRequest(req, res);

    expect(pool.connect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: '❗ Item 101 is assigned more than once',
    }));
  });
});