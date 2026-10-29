const gate = require("../services/surgicalConsignmentFinancialGate");
const po = { id: 4, supplier_id: 5, currency: "IQD" },
  actor = { id: 1, institute_id: 2 };
const client = ({
  prior = "0",
  status = "BILLING_LINKED",
  available = true,
} = {}) => ({
  query: jest.fn(async (sql) => {
    if (sql.includes("surgical_consignment_available"))
      return { rows: [{ surgical_consignment_available: available }] };
    if (sql.includes("WHERE billing_po_id"))
      return {
        rows: [
          { id: 7, institute_id: 2, status, supplier_id: 5, currency: "IQD" },
        ],
      };
    if (sql.includes("SELECT b.*"))
      return {
        rows: [
          {
            purchase_order_item_id: 10,
            used_quantity: 3,
            unit_price: "10",
            batch_number: "LOT",
          },
        ],
      };
    if (sql.includes("sum(l.quantity)")) return { rows: [{ quantity: prior }] };
    throw new Error("Unexpected query");
  }),
});
test("all submitted non-void invoices count toward confirmed use, before matching or payment", async () => {
  await expect(
    gate.invoice(
      client({ prior: "2" }),
      po,
      [{ purchase_order_item_id: 10, quantity: 2, unit_price: 10 }],
      "IQD",
      actor,
    ),
  ).rejects.toMatchObject({ code: "SURGICAL_CONSIGNMENT_OVERBILLING" });
  await expect(
    gate.invoice(
      client({ prior: "2" }),
      po,
      [{ purchase_order_item_id: 10, quantity: 1, unit_price: 10 }],
      "IQD",
      actor,
    ),
  ).resolves.toBeUndefined();
});
test("unexpected, unused or repriced lines cannot be invoiced", async () => {
  for (const row of [
    { purchase_order_item_id: 11, quantity: 1, unit_price: 10 },
    { purchase_order_item_id: 10, quantity: 1, unit_price: 11 },
  ])
    await expect(
      gate.invoice(client(), po, [row], "IQD", actor),
    ).rejects.toMatchObject({ code: "SURGICAL_CONSIGNMENT_INVOICE_MISMATCH" });
  await expect(
    gate.invoice(
      client(),
      po,
      [{ purchase_order_item_id: 10, quantity: 1, unit_price: 10 }],
      "USD",
      actor,
    ),
  ).rejects.toThrow("currency");
});
test("a consignment receipt is documentary, same-lot and non-inventory with no unused damage charges", async () => {
  const row = {
    purchase_order_item_id: 10,
    received_quantity: 3,
    line_type: "NON_INVENTORY",
    batch_number: "LOT",
  };
  await expect(
    gate.receipt(client(), po, [row], actor),
  ).resolves.toBeUndefined();
  for (const override of [
    { line_type: "INVENTORY" },
    { batch_number: "OTHER" },
    { damaged_quantity: 1 },
    { received_quantity: 10 },
  ])
    await expect(
      gate.receipt(client(), po, [{ ...row, ...override }], actor),
    ).rejects.toMatchObject({ code: "SURGICAL_CONSIGNMENT_RECEIPT_MISMATCH" });
});
test("foreign institute and un-reconciled state cannot use a linked consignment", async () => {
  await expect(
    gate.invoice(client(), po, [], "IQD", { institute_id: 99 }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    gate.invoice(client({ status: "USAGE_REVIEW" }), po, [], "IQD", actor),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("legacy databases without SQL 051 preserve existing P2P behavior", async () => {
  await expect(
    gate.invoice(client({ available: false }), po, [], "IQD", actor),
  ).resolves.toBeUndefined();
});
