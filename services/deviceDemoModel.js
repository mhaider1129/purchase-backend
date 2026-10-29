"use strict";
const {
  error,
  text,
  snapshotItem,
  fingerprint,
} = require("./preprocurementTechnicalReviewModel");
const permission = (actor, code) =>
  Boolean(actor?.hasPermission?.(code) || actor?.permissions?.includes(code));
const role = (actor) =>
  String(actor?.role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
const isScm = (actor) =>
  role(actor) === "scm" &&
  (permission(actor, "technical-inspections.manage") ||
    permission(actor, "requests.manage"));
const isMedical = (actor) =>
  role(actor) === "medicaldevices" ||
  permission(actor, "approval-authority.medical-devices");
const isCoo = (actor) =>
  role(actor) === "coo" || permission(actor, "approval-authority.coo");
const initiator = (actor) => isScm(actor) || isMedical(actor);
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw error(400, "Invalid record ID");
  return String(value);
};
const required = (value, label, max = 10000) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw error(400, `${label} is required (maximum ${max} characters)`);
  return value.trim();
};
const date = (value) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw error(400, "Enter a valid date");
  return value;
};
const DEFAULT_CRITERIA = [
  { key: "technical", name: "Technical performance", weight: 35 },
  { key: "clinical", name: "Suitability for intended use", weight: 30 },
  { key: "usability", name: "Usability and training", weight: 20 },
  { key: "support", name: "Service and support", weight: 15 },
];
function criteria(input = DEFAULT_CRITERIA) {
  if (!Array.isArray(input) || !input.length || input.length > 20)
    throw error(400, "Choose 1–20 evaluation criteria");
  const rows = input.map((row) => ({
    key: required(row.key, "Criterion key", 50),
    name: required(row.name, "Criterion name", 150),
    weight: Number(row.weight),
  }));
  if (
    rows.some(
      (row) =>
        !/^\w+$/.test(row.key) ||
        !Number.isInteger(row.weight) ||
        row.weight < 1,
    ) ||
    new Set(rows.map((row) => row.key)).size !== rows.length ||
    rows.reduce((n, row) => n + row.weight, 0) !== 100
  )
    throw error(
      400,
      "Criterion keys must be unique and positive whole-number weights must total 100",
    );
  return rows;
}
function report(input, definition) {
  if (
    !Array.isArray(input.scores) ||
    input.scores.length !== definition.length ||
    new Set(input.scores.map((row) => row.key)).size !== definition.length
  )
    throw error(400, "Score every evaluation criterion once");
  const scores = definition.map((criterion) => {
    const row = input.scores.find((row) => row.key === criterion.key);
    if (
      !row ||
      row.score === null ||
      row.score === "" ||
      !Number.isInteger(Number(row.score)) ||
      Number(row.score) < 0 ||
      Number(row.score) > 5
    )
      throw error(400, "Each criterion needs a whole-number score from 0 to 5");
    return {
      key: criterion.key,
      score: Number(row.score),
      comment: required(row.comment, "Criterion evidence"),
    };
  });
  if (!["SUITABLE", "NOT_SUITABLE"].includes(input.recommendation))
    throw error(400, "Choose a suitability recommendation");
  return {
    scores,
    weighted_score: scores.reduce(
      (sum, row) =>
        sum +
        (row.score * definition.find((c) => c.key === row.key).weight) / 5,
      0,
    ),
    recommendation: input.recommendation,
    findings: required(input.findings, "Evaluation findings"),
    safety_findings: required(input.safety_findings, "Safety findings"),
  };
}
const NEXT = {
  PLANNED: ["RECEIVED", "WITHDRAWN"],
  RECEIVED: ["EVALUATING", "WITHDRAWN"],
  EVALUATING: ["COMPLETED", "WITHDRAWN"],
  COMPLETED: [],
  WITHDRAWN: [],
};
function comparison(demos, reports, reviewers) {
  const completed = demos.filter((d) => d.status === "COMPLETED");
  if (
    !completed.length ||
    demos.some((d) => !["COMPLETED", "WITHDRAWN"].includes(d.status))
  )
    throw error(
      409,
      "Complete or withdraw every demo before recommending a selection",
    );
  return completed.map((d) => {
    const rows = reports.filter((r) => String(r.demo_id) === String(d.id));
    if (
      rows.length !== reviewers.length ||
      reviewers.some(
        (u) =>
          !rows.some((r) => String(r.reviewer_id) === String(u.reviewer_id)),
      )
    )
      throw error(
        409,
        "Every assigned evaluator must report on every completed demo",
      );
    return {
      ...d,
      average_score:
        Math.round(
          (rows.reduce((n, r) => n + Number(r.weighted_score), 0) /
            rows.length) *
            1000,
        ) / 1000,
      suitable: rows.every((r) => r.recommendation === "SUITABLE"),
      reports: rows,
    };
  });
}
module.exports = {
  error,
  text,
  snapshotItem,
  fingerprint,
  permission,
  role,
  isScm,
  isMedical,
  isCoo,
  initiator,
  id,
  required,
  date,
  criteria,
  report,
  comparison,
  DEFAULT_CRITERIA,
  NEXT,
};
