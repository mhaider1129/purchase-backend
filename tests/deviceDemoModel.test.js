"use strict";
const m = require("../services/deviceDemoModel");
test("criteria are fixed before comparisons, with unique keys and total weight 100", () => {
  expect(m.criteria()).toEqual(m.DEFAULT_CRITERIA);
  expect(() => m.criteria([{ key: "a", name: "A", weight: 20 }])).toThrow(
    "total 100",
  );
  expect(() =>
    m.criteria([
      { key: "a", name: "A", weight: 50 },
      { key: "a", name: "B", weight: 50 },
    ]),
  ).toThrow("unique");
});
const report = () => ({
  recommendation: "SUITABLE",
  findings: "Meets intended use",
  safety_findings: "No issues observed",
  scores: m.DEFAULT_CRITERIA.map((c) => ({
    key: c.key,
    score: 4,
    comment: "Trial evidence",
  })),
  weighted_score: 100,
  signature: { name: "forged" },
});
test("server computes weighted score and ignores client score and signature", () => {
  const r = m.report(report(), m.DEFAULT_CRITERIA);
  expect(r.weighted_score).toBe(80);
  expect(r).not.toHaveProperty("signature");
});
test.each([null, "", 6, -1, 1.5])(
  "invalid criterion score %s cannot create a report",
  (score) => {
    const r = report();
    r.scores[0].score = score;
    expect(() => m.report(r, m.DEFAULT_CRITERIA)).toThrow("0 to 5");
  },
);
test("comparison needs completed demos and every required evaluator, and preserves unsuitability", () => {
  const demos = [
      { id: 1, status: "COMPLETED" },
      { id: 2, status: "WITHDRAWN" },
    ],
    reviewers = [{ reviewer_id: 4 }, { reviewer_id: 5 }];
  expect(() => m.comparison(demos, [], reviewers)).toThrow("Every assigned");
  const reports = reviewers.map((r) => ({
    ...r,
    demo_id: 1,
    weighted_score: 80,
    recommendation: "SUITABLE",
  }));
  expect(m.comparison(demos, reports, reviewers)[0]).toMatchObject({
    average_score: 80,
    suitable: true,
  });
  reports[0].recommendation = "NOT_SUITABLE";
  expect(m.comparison(demos, reports, reviewers)[0].suitable).toBe(false);
  expect(() =>
    m.comparison(
      [...demos, { id: 3, status: "EVALUATING" }],
      reports,
      reviewers,
    ),
  ).toThrow("withdraw every");
});
test("COO authority is distinct from coordination, with no implicit Admin override", () => {
  expect(m.isCoo({ role: "Admin", hasPermission: () => false })).toBe(false);
  expect(m.isCoo({ role: "COO" })).toBe(true);
  expect(m.isScm({ role: "SCM", permissions: ["requests.manage"] })).toBe(true);
  expect(m.isMedical({ role: "Medical Devices" })).toBe(true);
});
test("dates are real calendar dates and lifecycle transitions require receipt and evaluation", () => {
  expect(() => m.date("2026-02-31")).toThrow("valid date");
  expect(m.NEXT.PLANNED).not.toContain("COMPLETED");
  expect(m.NEXT.COMPLETED).toEqual([]);
});
