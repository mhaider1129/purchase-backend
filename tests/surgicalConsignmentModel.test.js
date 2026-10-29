const m = require("../services/surgicalConsignmentModel");
const lot = {
  id: 1,
  receipt_id: 2,
  item_name: "Screw",
  catalogue_code: "SCREW-35-20",
  batch_number: "LOT-1",
  delivered_quantity: 10,
  unit_price: "12.3456",
  accepted: true,
};
const usage = {
  receipt_line_id: 1,
  used_quantity: 3,
  damaged_quantity: 0,
  missing_quantity: 0,
  notes: "Confirmed",
};
test("only used units are billable; temporary delivery and unused returns do not create cost", () => {
  const result = m.ready(
    [lot],
    [usage],
    [{ receipt_line_id: 1, kind: "INTACT", quantity: 7 }],
    [],
  )[0];
  expect(result).toMatchObject({
    billable_quantity: 3,
    remaining_intact: 0,
    line_amount: "37.04",
  });
  expect(m.total([result])).toBe("37.04");
  expect(result.billing_description).toBe("Screw [SCREW-35-20] / lot LOT-1");
});
test("all lots, including zero use, must balance before F20", () => {
  expect(() => m.ready([lot], [], [], [])).toThrow("every delivered lot");
  expect(() => m.ready([lot], [usage], [], [])).toThrow("Return all");
  expect(() =>
    m.reconcile(
      [lot],
      [usage],
      [{ receipt_line_id: 1, kind: "INTACT", quantity: 8 }],
      [],
    ),
  ).toThrow("exceed");
});
test("quarantined lots cannot be used", () => {
  expect(() =>
    m.reconcile([{ ...lot, accepted: false }], [usage], [], []),
  ).toThrow("quarantined");
});
test("damaged and missing units require evidence-based no-charge resolution and never enter used billing", () => {
  const u = { ...usage, damaged_quantity: 1, missing_quantity: 1 };
  const returns = [
    { receipt_line_id: 1, kind: "INTACT", quantity: 5 },
    { receipt_line_id: 1, kind: "DAMAGED", quantity: 1 },
  ];
  expect(() => m.ready([lot], [u], returns, [])).toThrow("resolve every");
  const waiver = {
    receipt_line_id: 1,
    usage_fingerprint: m.usageFingerprint(u),
    disposed_quantity: 0,
    vendor_no_charge: true,
  };
  expect(m.ready([lot], [u], returns, [waiver])[0]).toMatchObject({
    billable_quantity: 3,
    line_amount: "37.04",
    unresolved_exception: false,
  });
  expect(() =>
    m.ready([lot], [{ ...u, missing_quantity: 0 }], returns, [waiver]),
  ).toThrow("Return all");
});
test.each([-1, 1.5, "NaN", 2147483648])(
  "invalid piece quantity %s is rejected",
  (q) => expect(() => m.quantity(q)).toThrow(),
);
test.each(["-1", "1.12345", "Infinity"])(
  "invalid agreed price %s is rejected",
  (v) => expect(() => m.price(v)).toThrow(),
);
test("dates reject invalid calendar dates", () =>
  expect(() => m.date("2026-02-31")).toThrow("valid calendar"));
