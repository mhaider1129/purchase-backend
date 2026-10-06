jest.mock("../config/db", () => ({ connect: jest.fn() }));
jest.mock("../utils/ensureRequestedItemPoIssuanceColumn", () =>
  jest.fn().mockResolvedValue(),
);
jest.mock("../utils/ensureRequestedItemFinancialsTable", () => ({
  ensureRequestedItemFinancialsTable: jest.fn().mockResolvedValue(),
}));
const pool = require("../config/db");
const {
  updateItemProcurementStatus,
  updateItemPurchasedQuantity,
} = require("../controllers/requestedItemsController");

test.each([null, "free_text", "pending_item_creation"])(
  "legacy procurement endpoints cannot purchase unresolved %s demand",
  async (mode) => {
    const item = {
      id: 11,
      request_id: 3,
      assigned_to: 7,
      request_mode: mode,
      catalog_status: mode ? "pending_mapping" : null,
      quantity: 5,
      purchased_quantity: 0,
      received_quantity: 0,
    };
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) =>
        sql.includes("SELECT ri.*")
          ? { rowCount: 1, rows: [item] }
          : { rows: [] },
      ),
    };
    pool.connect.mockResolvedValue(client);
    const actor = { id: 7, hasPermission: () => true };
    for (const [handler, body] of [
      [updateItemProcurementStatus, { procurement_status: "purchased" }],
      [
        updateItemProcurementStatus,
        { procurement_status: "partially_procured" },
      ],
      [updateItemPurchasedQuantity, { purchased_quantity: 2 }],
    ]) {
      client.query.mockClear();
      const next = jest.fn();
      const res = { json: jest.fn() };
      await handler({ params: { item_id: 11 }, body, user: actor }, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          code: "ITEM_IDENTITY_RESOLUTION_REQUIRED",
        }),
      );
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(
        client.query.mock.calls.some(([sql]) =>
          /^\s*UPDATE public.requested_items/.test(sql),
        ),
      ).toBe(false);
      expect(res.json).not.toHaveBeenCalled();
    }
  },
);
