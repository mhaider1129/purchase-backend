const {
  CHECKLIST,
  normalizeReports,
  normalizeEvidence,
  snapshotItem,
  fingerprint,
  canManage,
} = require("../services/preprocurementTechnicalReviewModel");
const evidence = {
  basis: "description",
  category: "Furniture",
  evidence_description: "Chair dimensions and safe working load",
  no_sample_reason: "Vendor cannot provide a sample",
};
const packets = [{ item_id: "1" }];
const concise = () => ({
  item_id: "1",
  assessment_version: 2,
  decision: "APPROVED",
  assessment: {
    specifications: "compliant",
    compatibility: "not_applicable",
    suitability: "suitable",
  },
});
test("concise suitability review does not fabricate the physical sample checklist", () => {
  const value = normalizeReports([concise()], packets)[0];
  expect(value.assessment).toEqual(concise().assessment);
  expect(value.checklist).toEqual({});
  expect(value.assessed_at).toEqual(expect.any(String));
});
test.each([
  ["specifications", "partially_compliant"],
  ["specifications", "requires_clarification"],
  ["compatibility", "incompatible"],
  ["suitability", "unsuitable"],
])("concise approval cannot conceal unresolved %s findings", (key, value) => {
  const row = concise();
  row.assessment[key] = value;
  expect(() => normalizeReports([row], packets)).toThrow(
    "Full technical approval",
  );
});
test("concise rejection requires corrective findings and ignores client attestation", () => {
  const row = {
    ...concise(),
    decision: "REJECTED",
    assessed_at: "forged",
    signed_by: 55,
  };
  expect(() => normalizeReports([row], packets)).toThrow("Explain");
  const result = normalizeReports(
    [{ ...row, findings: "Revise the proposed model" }],
    packets,
  )[0];
  expect(result).not.toHaveProperty("signed_by");
  expect(result.assessed_at).not.toBe("forged");
});
const report = () => ({
  item_id: "1",
  decision: "APPROVED",
  inspection_date: "2026-10-29",
  inspection_time: "09:30",
  overall_condition: "good",
  findings: "Specifications are met by the supplied evidence.",
  checklist: Object.fromEntries(
    Object.entries(CHECKLIST).map(([key, options]) => [
      key,
      { condition: options[0] },
    ]),
  ),
});
test("alternative evidence requires a reason and a data sheet requires a request attachment", () => {
  expect(normalizeEvidence(evidence)).toMatchObject(evidence);
  expect(() =>
    normalizeEvidence({ ...evidence, no_sample_reason: "" }),
  ).toThrow("physical sample");
  expect(() => normalizeEvidence({ ...evidence, basis: "data_sheet" })).toThrow(
    "data sheet",
  );
  expect(() =>
    normalizeEvidence({
      ...evidence,
      basis: "sample",
      sample_received_date: "2026-02-31",
    }),
  ).toThrow("sample received date");
});
test("every selected item and checklist check must be explicitly reported", () => {
  expect(normalizeReports([report()], packets)).toHaveLength(1);
  expect(() => normalizeReports([], packets)).toThrow("every item");
  const incomplete = report();
  delete incomplete.checklist.specifications;
  expect(() => normalizeReports([incomplete], packets)).toThrow(
    "specifications",
  );
});
test("failed critical checks cannot be approved and forged inspector identity is ignored", () => {
  const failed = report();
  failed.checklist.specifications.condition = "not_met";
  expect(() => normalizeReports([failed], packets)).toThrow(
    "cannot be approved",
  );
  failed.decision = "REJECTED";
  expect(normalizeReports([failed], packets)[0].decision).toBe("REJECTED");
  expect(
    normalizeReports(
      [{ ...report(), inspector_name: "Forged", signed_by: 999 }],
      packets,
    )[0],
  ).not.toHaveProperty("signed_by");
});
test("material request changes invalidate a clearance while procurement progress does not", () => {
  const row = {
    id: 1,
    request_id: 2,
    item_name: "Chair",
    quantity: 2,
    specs: "Load 120kg",
  };
  expect(fingerprint(snapshotItem(row))).toBe(
    fingerprint(snapshotItem({ ...row, purchased_quantity: 1 })),
  );
  expect(fingerprint(snapshotItem(row))).not.toBe(
    fingerprint(snapshotItem({ ...row, specs: "Load 80kg" })),
  );
});
test("SCM authority requires both the management capability and an eligible procurement role", () => {
  expect(
    canManage({ role: "SCM", permissions: ["technical-inspections.manage"] }),
  ).toBe(true);
  expect(
    canManage({ role: "HOD", permissions: ["technical-inspections.manage"] }),
  ).toBe(false);
  expect(canManage({ role: "SCM", permissions: [] })).toBe(false);
});

test("unassessed specifications cannot authorize procurement", () => {
  const unassessed = report();
  unassessed.checklist.specifications.condition = "not_assessed";
  expect(() => normalizeReports([unassessed], packets)).toThrow(
    "must be assessed",
  );
});
