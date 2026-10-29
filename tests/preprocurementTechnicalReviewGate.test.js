const {
  assertTechnicalClearance,
} = require("../services/preprocurementTechnicalReviewGate");
const {
  snapshotItem,
  fingerprint,
} = require("../services/preprocurementTechnicalReviewModel");
const item = {
  id: 11,
  request_id: 2,
  item_name: "Chair",
  quantity: 2,
  specs: "120kg",
  institute_id: 7,
  requesting_department_id: 9,
  request_type: "Stock",
  request_status: "Approved",
};
const fixture = ({
  status = "APPROVED",
  required = false,
  history = true,
  stale = false,
} = {}) => ({
  query: jest.fn(async (sql) => {
    if (sql.includes("technical_review_available"))
      return { rows: [{ technical_review_available: true }] };
    if (sql.includes("SELECT ri.*")) return { rows: [item] };
    if (sql.includes("SELECT require_for_all"))
      return { rows: [{ require_for_all: required }] };
    if (sql.includes("SELECT id,status,item_packets"))
      return {
        rows: history
          ? [
              {
                id: 1,
                status,
                requesting_department_id: 9,
                item_packets: [
                  {
                    item_id: "11",
                    fingerprint: stale
                      ? "old"
                      : fingerprint(snapshotItem(item)),
                  },
                ],
              },
            ]
          : [],
      };
    return { rows: [] };
  }),
});
test.each(["create_award", "create_purchase_order", "register_procurement"])(
  "%s requires department opinions and SCM clearance once routed",
  async (command) => {
    await expect(
      assertTechnicalClearance(
        fixture({ status: "IN_REVIEW" }),
        item,
        {},
        command,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "TECHNICAL_REVIEW_REQUIRED",
    });
    await expect(
      assertTechnicalClearance(fixture(), item, {}, command),
    ).resolves.toBeUndefined();
  },
);
test("sourcing and quotations remain possible to obtain a sample or data sheet", async () => {
  const client = fixture({ status: "IN_REVIEW" });
  await assertTechnicalClearance(client, item, {}, "start_sourcing");
  await assertTechnicalClearance(client, item, {}, "submit_quotation");
  expect(client.query).not.toHaveBeenCalled();
});
test("policy distinguishes never-routed requests from an enabled institution-wide requirement", async () => {
  await expect(
    assertTechnicalClearance(
      fixture({ history: false }),
      item,
      {},
      "create_purchase_order",
    ),
  ).resolves.toBeUndefined();
  await expect(
    assertTechnicalClearance(
      fixture({ history: false, required: true }),
      item,
      {},
      "create_purchase_order",
    ),
  ).rejects.toMatchObject({ code: "TECHNICAL_REVIEW_REQUIRED" });
});
test.each(["REJECTED", "CANCELLED"])(
  "%s is not technical clearance",
  async (status) => {
    await expect(
      assertTechnicalClearance(
        fixture({ status }),
        item,
        {},
        "register_procurement",
      ),
    ).rejects.toMatchObject({ code: "TECHNICAL_REVIEW_REQUIRED" });
  },
);
test("a changed item requires a new technical round", async () => {
  await expect(
    assertTechnicalClearance(
      fixture({ stale: true }),
      item,
      {},
      "create_award",
    ),
  ).rejects.toMatchObject({ code: "TECHNICAL_REVIEW_STALE" });
});
