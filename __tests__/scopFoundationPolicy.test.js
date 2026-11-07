const p = require("../policies/scopFoundationPolicy");
test.each([
  true,
  false,
  null,
  {},
  [],
  NaN,
  Infinity,
  "-1",
  "1e3",
  "0.0000001",
  "9999999999999999999",
  0.1,
])("rejects non-exact quantity %p", (value) =>
  expect(() => p.positive(value)).toThrow(),
);
test("exact decimal conservation above JavaScript integer precision", () => {
  expect(p.decimal(p.scaled("9007199254740993.100001"))).toBe(
    "9007199254740993.100001",
  );
  expect(p.positive("0.000001")).toBe("0.000001");
  expect(p.decimal("1.000000000000")).toBe("1.000000");
  expect(() => p.positive("0")).toThrow();
});
test("quantity ceiling cannot be exceeded by fractional allocations", () => {
  p.capacity("10", ["3.000001", "6.999999"]);
  expect(() => p.capacity("10", ["3.000001", "7"])).toThrow();
});
test("purchasing alone cannot fulfill", () => {
  const v = p.progress("10", { ordered: "10" });
  expect(v.outstanding_quantity).toBe("10.000000");
  expect(v.physical_state).toBe("NOT_RECEIVED");
});
test("replacement delivery does not inflate accepted progress", () => {
  const v = p.progress("10", { received: "12", accepted: "10", rejected: "2" });
  expect(v.evidence_conflict).toBe(false);
  expect(v.outstanding_quantity).toBe("10.000000");
  expect(v.outstanding_acceptance_quantity).toBe("0.000000");
});
test("pending and quarantined stock cannot satisfy accepted/issued progress", () => {
  const v = p.progress("10", {
    received: "10",
    pending_inspection: "6",
    quarantined: "4",
  });
  expect(v.accepted_quantity).toBe("0.000000");
  expect(v.outstanding_quantity).toBe("10.000000");
  expect(v.evidence_conflict).toBe(false);
});
test("detects excess or inconsistent evidence without capping away conflict", () => {
  expect(
    p.progress("10", { accepted: "11", received: "11" }).evidence_conflict,
  ).toBe(true);
  expect(
    p.progress("10", { received: "4", accepted: "4", rejected: "2" })
      .evidence_conflict,
  ).toBe(true);
});
test("direct accepted delivery and canonical issue are distinct fulfillment paths", () => {
  expect(
    p.progress("10", { received: "10", accepted: "10", direct_accepted: "10" })
      .outstanding_quantity,
  ).toBe("0.000000");
  expect(p.progress("10", { issued: "10" }).physical_state).toBe("FULFILLED");
});

test("final rejected delivery is not mislabeled pending inspection", () => {
  const r = p.progress("10", { received: "10", rejected: "10" });
  expect(r.physical_state).toBe("REJECTED_OR_SHORT");
  expect(r.accepted_quantity).toBe("0.000000");
  expect(r.outstanding_quantity).toBe("10.000000");
});
test("partial ordering and physical holds have independent lifecycle states", () => {
  expect(p.progress("10", { ordered: "4" }).sourcing_state).toBe(
    "PARTIALLY_ORDERED",
  );
  expect(
    p.progress("10", { received: "10", quarantined: "10" }).physical_state,
  ).toBe("QUARANTINED");
  expect(
    p.progress("10", { received: "10", pending_inspection: "10" })
      .physical_state,
  ).toBe("PENDING_INSPECTION");
});
