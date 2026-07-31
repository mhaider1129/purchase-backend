const {
  createStockItemRequest,
  updateStockItemRequestStatus,
} = require("../controllers/stockItemRequestsController");

jest.mock("../config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../utils/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));

const db = require("../config/db");
const { createNotification } = require("../utils/notificationService");

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe("stockItemRequestsController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createStockItemRequest", () => {
    it("prevents creating a request that already exists in inventory", async () => {
      const req = {
        body: { name: "Mask", description: "N95 mask", unit: "box" },
        user: { id: 4, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = buildRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10 }] });

      await createStockItemRequest(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 409 }),
      );
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("updateStockItemRequestStatus", () => {
    it("reuses and audits a stock item created by a concurrent approval", async () => {
      const req = {
        params: { id: "7" },
        body: {
          status: "approved",
          legacy_creation_reason: "Approved legacy exception",
        },
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
        .mockResolvedValueOnce({
          rows: [
            { table_name: "stock_items", column_name: "identity_source" },
            { table_name: "item_master_audit_events", column_name: "id" },
          ],
        }) // capability check
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 7,
              name: "Mask",
              unit: "box",
              status: "pending",
              description: "N95 mask",
              requested_by: 8,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // normalized pre-check
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // insert conflict
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 55, name: "Mask", unit: "box" }],
        }) // explicit conflict lookup
        .mockResolvedValueOnce({}) // item master reuse audit
        .mockResolvedValueOnce({ rows: [{ id: 7, status: "approved" }] })
        .mockResolvedValueOnce({}) // audit log
        .mockResolvedValueOnce({}); // COMMIT

      await updateStockItemRequestStatus(req, res, next);

      expect(client.query).toHaveBeenCalledWith("BEGIN");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stock_item: { id: 55, created: false, reused: true },
          audit_action: "legacy_creation_reused",
        }),
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("VALUES('stock_item',$1,$2,$3,$4,$5)"),
        expect.arrayContaining([55, "legacy_creation_reused"]),
      );
      expect(client.release).toHaveBeenCalled();
    });

    it("approves a request, creates stock item, and notifies requester", async () => {
      const req = {
        params: { id: "5" },
        body: {
          status: "approved",
          review_notes: "Looks good",
          legacy_creation_reason:
            "Approved exception for urgent legacy request",
        },
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
        .mockResolvedValueOnce({
          rows: [
            { table_name: "stock_items", column_name: "identity_source" },
            { table_name: "item_master_audit_events", column_name: "id" },
          ],
        }) // capability check
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 5,
              name: "Mask",
              unit: "box",
              status: "pending",
              description: "N95 mask",
              requested_by: 9,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // normalized pre-check
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 42, name: "Mask" }],
        }) // insert stock item
        .mockResolvedValueOnce({}) // item master audit event
        .mockResolvedValueOnce({
          rows: [
            {
              id: 5,
              status: "approved",
              review_notes: "Looks good",
              approved_by: 2,
              name: "Mask",
            },
          ],
        })
        .mockResolvedValueOnce({}) // audit log
        .mockResolvedValueOnce({}); // COMMIT

      await updateStockItemRequestStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stock_item: { id: 42, created: true, reused: false },
          audit_action: "legacy_creation_approved",
        }),
      );
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 9,
          metadata: { requestId: 5, status: "approved" },
        }),
        client,
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("fails closed before beginning when legacy audit capability is absent", async () => {
      const req = {
        params: { id: "5" },
        body: {
          status: "approved",
          legacy_creation_reason: "Approved legacy exception",
        },
        user: { id: 2, hasPermission: jest.fn().mockReturnValue(true) },
      };
      const res = buildRes();
      const next = jest.fn();
      const client = { query: jest.fn(), release: jest.fn() };

      db.query.mockResolvedValueOnce({});
      db.connect.mockResolvedValue(client);
      client.query.mockResolvedValueOnce({ rows: [] });

      await updateStockItemRequestStatus(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "database_capability_unavailable",
          statusCode: 503,
        }),
      );
      expect(client.query).not.toHaveBeenCalledWith("BEGIN");
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});