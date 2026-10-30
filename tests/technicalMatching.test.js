const { matchInvoice } = require("../services/invoiceMatchingService");
const invoice = {
  supplier_id: 2,
  currency: "IQD",
  lines: [{ purchase_order_item_id: 1, quantity: "10", unit_price: "5" }],
};
const purchaseOrder = {
  supplier_id: 2,
  currency: "IQD",
  lines: [{ id: 1, line_type: "SERVICE", quantity: "10", unit_price: "5" }],
};
test("a service with a required technical acceptance cannot use two-way matching to bypass the hold", () => {
  const result = matchInvoice({
    invoice,
    purchaseOrder,
    acceptedReceipts: [
      {
        purchase_order_item_id: 1,
        accepted_quantity: "0",
        technical_inspection_required: true,
      },
    ],
  });
  expect(result.matched).toBe(false);
  expect(result.policy).toBe("THREE_WAY");
  expect(result.variances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_RECEIPT" }),
    ]),
  );
});
test("ordinary service matching remains two-way without a technical requirement", () => {
  const result = matchInvoice({ invoice, purchaseOrder, acceptedReceipts: [] });
  expect(result.matched).toBe(true);
  expect(result.policy).toBe("TWO_WAY");
});
