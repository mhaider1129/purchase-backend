const {
  issueWarehouseStock,
} = require('../controllers/warehouseInventoryController');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../utils/ensureWarehouseAssignments', () => jest.fn().mockResolvedValue());
jest.mock('../utils/ensureWarehouseInventoryTables', () => jest.fn().mockResolvedValue());

const db = require('../config/db');

describe('warehouseInventoryController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('issueWarehouseStock', () => {
    it('rejects issuing stock without the correct permission', async () => {
      const req = {
        body: {},
        user: { hasPermission: jest.fn().mockReturnValue(false) },
      };
      const res = {};
      const next = jest.fn();

      await issueWarehouseStock(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('fails when stock is unavailable or insufficient', async () => {
      const client = { query: jest.fn(), release: jest.fn() };
      db.connect.mockResolvedValue(client);

      client.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, name: 'Gloves' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: 2 }] })
        .mockResolvedValueOnce({});

      const req = {
        body: { department_id: 5, items: [{ stock_item_id: 1, quantity: 5 }] },
        user: { id: 9, warehouse_id: 4, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await issueWarehouseStock(req, res, next);

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: expect.stringContaining('Insufficient stock') }),
      );
      expect(res.status).not.toHaveBeenCalled();
    });

    it('issues stock to a department and records the new balance', async () => {
      const client = { query: jest.fn(), release: jest.fn() };
      db.connect.mockResolvedValue(client);

      client.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3, name: 'Masks' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7, quantity: 10 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 7,
              warehouse_id: 1,
              stock_item_id: 3,
              item_name: 'Masks',
              quantity: 7,
              updated_at: '2024-01-01T00:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const req = {
        body: {
          department_id: 2,
          notes: 'Urgent restock',
          items: [
            {
              stock_item_id: 3,
              quantity: 3,
              notes: 'Urgent restock',
            },
          ],
        },
        user: { id: 12, warehouse_id: 1, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await issueWarehouseStock(req, res, next);

      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Stock issued to department',
          balances: [expect.objectContaining({ quantity: 7 })],
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('issues multiple stock items in a single transaction', async () => {
      const client = { query: jest.fn(), release: jest.fn() };
      db.connect.mockResolvedValue(client);

      client.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 4 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 11, name: 'Gloves' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 21, quantity: 15 }] })
        .mockResolvedValueOnce({
          rows: [
            { id: 21, warehouse_id: 2, stock_item_id: 11, item_name: 'Gloves', quantity: 10, updated_at: '2024-01-01' },
          ],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 12, name: 'Masks' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 22, quantity: 8 }] })
        .mockResolvedValueOnce({
          rows: [
            { id: 22, warehouse_id: 2, stock_item_id: 12, item_name: 'Masks', quantity: 5, updated_at: '2024-01-01' },
          ],
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const req = {
        body: {
          department_id: 4,
          warehouse_id: 2,
          items: [
            { stock_item_id: 11, quantity: 5 },
            { stock_item_id: 12, quantity: 3 },
          ],
        },
        user: { id: 44, warehouse_id: 2, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await issueWarehouseStock(req, res, next);

      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          balances: [
            expect.objectContaining({ stock_item_id: 11, quantity: 10 }),
            expect.objectContaining({ stock_item_id: 12, quantity: 5 }),
          ],
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});