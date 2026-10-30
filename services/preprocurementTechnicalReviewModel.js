"use strict";
const { createHash } = require("node:crypto");
const error = (statusCode, message, code = "TECHNICAL_REVIEW_INVALID") =>
  Object.assign(new Error(message), { statusCode, code });
const CHECKLIST = {
  packaging: ["intact", "damaged", "not_applicable", "not_assessed"],
  labelling: ["clear", "incomplete", "not_applicable", "not_assessed"],
  physical_appearance: [
    "good",
    "fair",
    "poor",
    "not_applicable",
    "not_assessed",
  ],
  specifications: ["met", "not_met", "not_assessed"],
  quality: ["good", "fair", "poor", "not_applicable", "not_assessed"],
  functionality: ["functional", "defective", "not_applicable", "not_assessed"],
  expiry: [
    "acceptable",
    "near_expiry",
    "expired",
    "not_applicable",
    "not_assessed",
  ],
  storage: ["met", "not_met", "not_applicable", "not_assessed"],
  sterility: ["intact", "compromised", "not_applicable", "not_assessed"],
  calibration: [
    "calibrated",
    "not_calibrated",
    "not_applicable",
    "not_assessed",
  ],
  safety: ["present", "missing", "not_applicable", "not_assessed"],
  structural_integrity: [
    "good",
    "fair",
    "poor",
    "not_applicable",
    "not_assessed",
  ],
  compatibility: [
    "compatible",
    "not_compatible",
    "not_applicable",
    "not_assessed",
  ],
  disinfectant: [
    "water",
    "alcohol",
    "water_and_alcohol",
    "other",
    "not_applicable",
    "not_assessed",
  ],
  sds: ["available", "missing", "not_applicable", "not_assessed"],
};
const CATEGORIES = [
  "Medication",
  "Medical Supply",
  "Device",
  "Medical Equipment",
  "Stationery",
  "Laboratory Item",
  "Maintenance Item",
  "Furniture",
  "IT Equipment",
  "Housekeeping Supply",
  "Other",
];
const ASSESSMENT = {
  specifications: [
    "compliant",
    "partially_compliant",
    "non_compliant",
    "requires_clarification",
  ],
  compatibility: [
    "compatible",
    "incompatible",
    "not_applicable",
    "requires_clarification",
  ],
  suitability: ["suitable", "unsuitable", "requires_clarification"],
};
const snapshotItem = (row) =>
  Object.fromEntries(
    [
      "id",
      "request_id",
      "item_name",
      "quantity",
      "specs",
      "brand",
      "unit_of_measure",
      "generic_item_id",
      "preferred_product_id",
      "mandatory_product_id",
    ].map((key) => [key, row[key] == null ? null : String(row[key])]),
  );
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canManage = (actor) =>
  Boolean(
    actor?.hasPermission?.("technical-inspections.manage") ||
    actor?.permissions?.includes("technical-inspections.manage"),
  ) &&
  ["scm", "admin", "procurementsupervisor", "procurement supervisor"].includes(
    String(actor?.role || "")
      .trim()
      .toLowerCase(),
  );
const text = (value, max = 10000) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
function normalizeEvidence(input = {}) {
  if (!["sample", "data_sheet", "description"].includes(input.basis))
    throw error(
      400,
      "Choose sample, data sheet or description as the review basis",
    );
  if (!CATEGORIES.includes(input.category))
    throw error(400, "Choose an item category");
  const evidence = {
    basis: input.basis,
    category: input.category,
    supplier_name: text(input.supplier_name, 250),
    manufacturer: text(input.manufacturer, 250),
    model_number: text(input.model_number, 250),
    serial_batch_number: text(input.serial_batch_number, 250),
    sample_received_date: text(input.sample_received_date, 10),
    evidence_description: text(input.evidence_description),
    no_sample_reason: text(input.no_sample_reason),
    attachment_ids: input.attachment_ids || [],
  };
  if (!evidence.evidence_description)
    throw error(
      400,
      "Describe the sample or technical evidence being reviewed",
    );
  if (evidence.basis !== "sample" && !evidence.no_sample_reason)
    throw error(400, "Explain why a physical sample is unavailable");
  if (
    !Array.isArray(evidence.attachment_ids) ||
    evidence.attachment_ids.length > 20 ||
    evidence.attachment_ids.some((id) => !/^\d+$/.test(String(id)))
  )
    throw error(400, "Invalid evidence attachments");
  if (evidence.basis === "data_sheet" && !evidence.attachment_ids.length)
    throw error(
      400,
      "Attach the data sheet to the request and select it as evidence",
    );
  if (evidence.basis === "sample" && !evidence.sample_received_date)
    throw error(400, "Record the physical sample received date");
  if (
    evidence.sample_received_date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.sample_received_date) ||
      Number.isNaN(Date.parse(evidence.sample_received_date)) ||
      new Date(evidence.sample_received_date).toISOString().slice(0, 10) !==
        evidence.sample_received_date)
  )
    throw error(400, "Invalid sample received date");
  return evidence;
}
function normalizeReports(input, packets) {
  if (
    !Array.isArray(input) ||
    input.length !== packets.length ||
    new Set(input.map((row) => String(row.item_id))).size !== packets.length
  )
    throw error(400, "Submit a report for every item in this review");
  return packets.map((packet) => {
    const report = input.find(
      (row) => String(row.item_id) === String(packet.item_id),
    );
    if (report?.assessment_version === 2) {
      if (!["APPROVED", "REJECTED"].includes(report.decision))
        throw error(400, "Choose a technical decision");
      const assessment = {};
      for (const [key, choices] of Object.entries(ASSESSMENT)) {
        if (!choices.includes(report.assessment?.[key]))
          throw error(400, `Complete the ${key} technical assessment`);
        assessment[key] = report.assessment[key];
      }
      if (
        report.decision === "APPROVED" &&
        (assessment.specifications !== "compliant" ||
          !["compatible", "not_applicable"].includes(
            assessment.compatibility,
          ) ||
          assessment.suitability !== "suitable")
      )
        throw error(
          400,
          "Full technical approval requires compliant specifications, compatibility and suitability. Unresolved findings must not be approved.",
        );
      if (report.decision !== "APPROVED" && !text(report.findings))
        throw error(
          400,
          "Explain the technical rejection or required corrective action",
        );
      // Preserve exactly what was assessed. Never fabricate responses to the
      // old physical sample checklist from a suitability assessment.
      return {
        item_id: String(packet.item_id),
        assessment_version: 2,
        assessment,
        decision: report.decision,
        findings: text(report.findings),
        checklist: {},
        assessed_at: new Date().toISOString(),
      };
    }
    if (
      !report ||
      !["APPROVED", "REJECTED"].includes(report.decision) ||
      !text(report.findings)
    )
      throw error(400, "Each item needs a technical decision and findings");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(report.inspection_date || "")) ||
      Number.isNaN(Date.parse(report.inspection_date)) ||
      new Date(report.inspection_date).toISOString().slice(0, 10) !==
        report.inspection_date ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(report.inspection_time || ""))
    )
      throw error(400, "Record a valid inspection date and time");
    const checklist = {};
    for (const [key, choices] of Object.entries(CHECKLIST)) {
      const row = report.checklist?.[key];
      if (!row || !choices.includes(row.condition))
        throw error(400, `Complete the ${key} inspection check`);
      checklist[key] = {
        condition: row.condition,
        comment: text(row.comment),
        action_required: text(row.action_required),
      };
    }
    if (
      report.decision === "APPROVED" &&
      checklist.specifications.condition === "not_assessed"
    )
      throw error(
        400,
        "Compliance with specifications must be assessed and met before approval",
      );
    if (
      report.decision === "APPROVED" &&
      [
        "not_met",
        "defective",
        "expired",
        "compromised",
        "missing",
        "not_compatible",
      ].some((condition) =>
        [
          "specifications",
          "functionality",
          "expiry",
          "sterility",
          "safety",
          "compatibility",
        ].some((key) => checklist[key].condition === condition),
      )
    )
      throw error(
        400,
        "An item with failed specifications or critical safety/function checks cannot be approved",
      );
    if (
      !["excellent", "good", "fair", "poor"].includes(report.overall_condition)
    )
      throw error(400, "Record the overall condition");
    return {
      item_id: String(packet.item_id),
      decision: report.decision,
      inspection_date: report.inspection_date,
      inspection_time: report.inspection_time,
      checklist,
      findings: text(report.findings),
      overall_condition: report.overall_condition,
      immediate_actions: text(report.immediate_actions),
      recommended_actions: text(report.recommended_actions),
      additional_comments: text(report.additional_comments),
    };
  });
}
module.exports = {
  ASSESSMENT,
  CHECKLIST,
  CATEGORIES,
  error,
  text,
  canManage,
  snapshotItem,
  fingerprint,
  normalizeEvidence,
  normalizeReports,
};
