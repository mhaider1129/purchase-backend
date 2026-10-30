const { assertDemoSelection } = require("../services/deviceDemoGate");
const { snapshotItem, fingerprint } = require("../services/deviceDemoModel");
const item = {
  id: 2,
  request_id: 3,
  quantity: 1,
  item_name: "Device",
  department_id: 7,
  institute_id: 1,
  request_status: "Approved",
};
function fixture({
  status = "SELECTED",
  stale = false,
  product = false,
  ordered = true,
  requestStatus = "Approved",
} = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes("SELECT * FROM public.device_demo_workspaces"))
        return {
          rows: [
            {
              id: 1,
              request_id: 3,
              institute_id: 1,
              requesting_department_id: 7,
              status,
              item_fingerprint: stale ? "old" : fingerprint(snapshotItem(item)),
            },
          ],
        };
      if (sql.includes("SELECT ri.*"))
        return { rows: [{ ...item, request_status: requestStatus }] };
      if (sql.includes("SELECT s.*"))
        return {
          rows: [
            {
              status: "APPROVED",
              decided_by: 9,
              signature: { user_id: 9 },
              supplier_id: 4,
              approved_product_id: product ? 20 : null,
              supplier_catalog_item_id: product ? 30 : null,
            },
          ],
        };
      if (sql.includes("AS ordered")) return { rows: [{ ordered }] };
      return { rows: [] };
    }),
  };
}
test.each(["OPEN", "COO_REVIEW", "REVISION_REQUIRED", "CANCELLED"])(
  "%s cannot release procurement",
  async (status) => {
    await expect(
      assertDemoSelection(fixture({ status }), item, {}, "create_award", {
        supplier_id: 4,
      }),
    ).rejects.toMatchObject({ code: "DEVICE_DEMO_SELECTION_REQUIRED" });
  },
);
test("COO-approved company is required and missing supplier cannot bypass quantity controls", async () => {
  await expect(
    assertDemoSelection(fixture(), item, {}, "register_procurement", {}),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_SUPPLIER_MISMATCH" });
  await expect(
    assertDemoSelection(fixture(), item, {}, "create_award", {
      supplier_id: 5,
    }),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_SUPPLIER_MISMATCH" });
  await expect(
    assertDemoSelection(fixture(), item, {}, "create_award", {
      supplier_id: 4,
    }),
  ).resolves.toBeUndefined();
});
test("normal purchase approval and unchanged requirements are still mandatory", async () => {
  await expect(
    assertDemoSelection(
      fixture({ requestStatus: "Submitted" }),
      item,
      {},
      "create_award",
      { supplier_id: 4 },
    ),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_REQUEST_NOT_APPROVED" });
  await expect(
    assertDemoSelection(fixture({ stale: true }), item, {}, "create_award", {
      supplier_id: 4,
    }),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_STALE" });
});
test("governed product and supplier catalog cannot be substituted and registration needs selected PO", async () => {
  await expect(
    assertDemoSelection(
      fixture({ product: true }),
      item,
      {},
      "create_purchase_order",
      { supplier_id: 4, approved_product_id: 21, supplier_catalog_item_id: 30 },
    ),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_PRODUCT_MISMATCH" });
  await expect(
    assertDemoSelection(
      fixture({ product: true, ordered: false }),
      item,
      {},
      "register_procurement",
      { supplier_id: 4 },
    ),
  ).rejects.toMatchObject({ code: "DEVICE_DEMO_SELECTED_PO_REQUIRED" });
  await expect(
    assertDemoSelection(fixture({ product: true }), item, {}, "create_award", {
      supplier_id: 4,
      approved_product_id: 20,
      supplier_catalog_item_id: 30,
    }),
  ).resolves.toBeUndefined();
});
