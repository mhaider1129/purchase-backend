const {
  createStockItemRequest,
  updateStockItemRequestStatus,
} = require('../controllers/stockItemRequestsController');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../utils/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));

const db = require('../config/db');
const { createNotification } = require('../utils/notificationService');

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('stockItemRequestsController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createStockItemRequest', () => {
    it('prevents creating a request that already exists in inventory', async () => {
      const req = {
        body: { name: 'Mask', description: 'N95 mask', unit: 'box' },
        user: { id: 4, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = buildRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10 }] });

      await createStockItemRequest(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 409 })
      );
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('updateStockItemRequestStatus', () => {
    it('rejects approval when a duplicate stock item exists', async () => {
      const req = {
        params: { id: '7' },
        body: { status: 'approved' },
        user: { id: 2, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = buildRes();
      const next = jest.fn();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };

      db.query.mockResolvedValueOnce({});
      db.connect.mockResolvedValue(client);

      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 7,
              name: 'Mask',
              unit: 'box',
              status: 'pending',
              description: 'N95 mask',
              requested_by: 8,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 55 }] }); // duplicate stock item

      await updateStockItemRequestStatus(req, res, next);

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 409 })
      );
      expect(client.release).toHaveBeenCalled();
    });

    it('approves a request, creates stock item, and notifies requester', async () => {
      const req = {
        params: { id: '5' },
        body: { status: 'approved', review_notes: 'Looks good' },
        user: { id: 2, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = buildRes();
      const next = jest.fn();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };

      db.query
        .mockResolvedValueOnce({}) // ensure review_notes column
        .mockResolvedValueOnce({}); // ensure notifications table

      db.connect.mockResolvedValue(client);

      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 5,
              name: 'Mask',
              unit: 'box',
              status: 'pending',
              description: 'N95 mask',
              requested_by: 9,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // duplicate stock item check
        .mockResolvedValueOnce({ rows: [{ id: 42, name: 'Mask' }] }) // insert stock item
        .mockResolvedValueOnce({
          rows: [
            {
              id: 5,
              status: 'approved',
              review_notes: 'Looks good',
              approved_by: 2,
              name: 'Mask',
            },
          ],
        })
        .mockResolvedValueOnce({}) // audit log
        .mockResolvedValueOnce({ rows: [{ id: 200 }] }) // notification insert
        .mockResolvedValueOnce({}); // COMMIT

      await updateStockItemRequestStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          created_stock_item: { id: 42, name: 'Mask' },
        })
      );
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 9,
          metadata: { requestId: 5, status: 'approved' },
        }),
        client
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});