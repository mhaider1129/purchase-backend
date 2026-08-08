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
    const createIssueClient = ({ departmentId, warehouseId, inventory }) => {
      let departmentStockLevelId = 100;
      const remainingByItem = new Map(inventory.map(item => [item.stockItemId, item.quantity]));
      const namesByItem = new Map(inventory.map(item => [item.stockItemId, item.name]));
      const stockLevelIds = new Map(inventory.map(item => [item.stockItemId, item.stockLevelId]));

      const client = { release: jest.fn() };
      client.query = jest.fn(async (sql, params = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('SELECT id FROM departments')) {
          return { rowCount: params[0] === departmentId ? 1 : 0, rows: [{ id: departmentId }] };
        }
        if (sql.includes('SELECT id, name FROM stock_items')) {
          const name = namesByItem.get(params[0]);
          return { rowCount: name ? 1 : 0, rows: name ? [{ id: params[0], name }] : [] };
        }
        if (sql.includes('FROM warehouse_stock_levels') && sql.includes('FOR UPDATE')) {
          const stockItemId = params[1];
          const quantity = remainingByItem.get(stockItemId);
          return {
            rowCount: quantity === undefined ? 0 : 1,
            rows: quantity === undefined ? [] : [{
              id: stockLevelIds.get(stockItemId), batch_id: null, lot_number: null,
              expiry_date: null, serial_number: null, quantity,
            }],
          };
        }
        if (sql.includes('UPDATE warehouse_stock_levels')) {
          const stockItemId = inventory.find(item => item.stockLevelId === params[0]).stockItemId;
          remainingByItem.set(stockItemId, remainingByItem.get(stockItemId) - params[1]);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM department_stock_levels')) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT INTO department_stock_levels')) {
          departmentStockLevelId += 1;
          return { rowCount: 1, rows: [{ id: departmentStockLevelId }] };
        }
        if (sql.includes('INSERT INTO department_stock_movements')) {
          expect(params[0]).toBe(departmentStockLevelId);
          return { rowCount: 1, rows: [{ id: departmentStockLevelId + 100 }] };
        }
        if (sql.includes('INSERT INTO warehouse_stock_movements')) {
          return { rowCount: 1, rows: [{ id: departmentStockLevelId + 200 }] };
        }
        if (sql.includes('INSERT INTO inventory_transactions')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM warehouse_stock_levels') && sql.includes('ORDER BY quantity')) {
          const stockItemId = params[1];
          return { rows: [{
            id: stockLevelIds.get(stockItemId), warehouse_id: warehouseId, stock_item_id: stockItemId,
            item_name: namesByItem.get(stockItemId), quantity: remainingByItem.get(stockItemId),
            updated_at: '2024-01-01T00:00:00.000Z',
          }] };
        }
        if (sql.includes('SELECT COALESCE(SUM(quantity)')) {
          return { rows: [{ total_quantity: remainingByItem.get(params[0]) }] };
        }
        // recalculateAvailableQuantity updates the stock item aggregate.
        if (sql.includes('UPDATE stock_items')) return { rowCount: 1, rows: [] };
        throw new Error(`Unexpected query in test: ${sql}`);
      });
      return client;
    };

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
      const client = createIssueClient({
        departmentId: 5,
        warehouseId: 4,
        inventory: [{ stockItemId: 1, stockLevelId: 1, name: 'Gloves', quantity: 2 }],
      });
      db.connect.mockResolvedValue(client);

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
      const client = createIssueClient({
        departmentId: 2,
        warehouseId: 1,
        inventory: [{ stockItemId: 3, stockLevelId: 7, name: 'Masks', quantity: 10 }],
      });
      db.connect.mockResolvedValue(client);

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
      const client = createIssueClient({
        departmentId: 4,
        warehouseId: 2,
        inventory: [
          { stockItemId: 11, stockLevelId: 21, name: 'Gloves', quantity: 15 },
          { stockItemId: 12, stockLevelId: 22, name: 'Masks', quantity: 8 },
        ],
      });
      db.connect.mockResolvedValue(client);

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