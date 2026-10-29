"use strict";
const { createHash } = require("node:crypto");
const {
  calculateLine,
  addDecimal,
  compareDecimal,
} = require("./purchaseOrderTotalsService");
const { userHasPermission } = require("../utils/permissionService");
const error = (statusCode, message, code = "SURGICAL_CONSIGNMENT_INVALID") =>
  Object.assign(new Error(message), { statusCode, code });
const text = (v, label, max = 10000) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw error(400, `${label} is required (maximum ${max} characters)`);
  return v.trim();
};
const id = (v) => {
  if (
    !/^\d+$/.test(String(v)) ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) < 1
  )
    throw error(400, "Invalid record ID");
  return String(v);
};
const quantity = (v, positive = false) => {
  if (
    !/^\d+$/.test(String(v)) ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) > 2 ** 31 - 1 ||
    Number(v) < (positive ? 1 : 0)
  )
    throw error(400, "Quantities must be non-negative whole pieces");
  return Number(v);
};
const price = (v) => {
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(String(v)))
    throw error(
      400,
      "Enter a non-negative agreed unit price with at most four decimal places",
    );
  return String(v);
};
const date = (v) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ||
    Number.isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw error(400, "Enter a valid calendar date");
  return v;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(
    new Date(),
  );
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const role = (u) =>
  String(u?.role || "")
    .toLowerCase()
    .replace(/[\s_]+/g, "");
const scm = (u) =>
  role(u) === "scm" &&
  (userHasPermission(u, "requests.manage") ||
    userHasPermission(u, "procurement.update-status") ||
    userHasPermission(u, "technical-inspections.manage"));
const cmo = (u) =>
  role(u) === "cmo" || userHasPermission(u, "approval-authority.cmo");
const finance = (u) =>
  userHasPermission(u, "finance.verify") ||
  userHasPermission(u, "procure-to-pay.invoices.manage");
const canCreate = (u) =>
  scm(u) || userHasPermission(u, "stock-requests.create");
const REASONS = [
  "NO_STOCK_EQUIVALENT",
  "SURGEON_REQUEST",
  "EMERGENCY",
  "PATIENT_SPECIFIC",
  "OTHER",
];
const PURPOSES = ["AGREEMENT", "RECEIPT", "RETURN", "USAGE", "WAIVER", "OTHER"];
const description = (line) =>
  `${line.item_name} [${line.catalogue_code}] / lot ${line.batch_number}`;
const usageFingerprint = (u) =>
  hash([
    String(u.receipt_line_id || u.id),
    Number(u.used_quantity),
    Number(u.damaged_quantity),
    Number(u.missing_quantity),
  ]);
function reconcile(lines, usages, returns, waivers) {
  return lines.map((line) => {
    const u = usages.find((u) => String(u.receipt_line_id) === String(line.id));
    if (!u)
      throw error(
        409,
        "Record usage for every delivered lot, including zero-used items",
      );
    const used = quantity(u.used_quantity),
      damaged = quantity(u.damaged_quantity),
      missing = quantity(u.missing_quantity);
    if (
      used + damaged + missing > line.delivered_quantity ||
      (!line.accepted && used > 0)
    )
      throw error(
        409,
        "Usage exceeds delivery or attempts to use a quarantined lot",
      );
    const returned = returns.filter(
      (r) => String(r.receipt_line_id) === String(line.id),
    );
    const good = returned
        .filter((r) => r.kind === "INTACT")
        .reduce((n, r) => n + Number(r.quantity), 0),
      bad = returned
        .filter((r) => r.kind === "DAMAGED")
        .reduce((n, r) => n + Number(r.quantity), 0);
    const remaining =
      Number(line.delivered_quantity) - used - damaged - missing - good;
    if (remaining < 0 || bad > damaged)
      throw error(409, "Returns and usage exceed the delivered quantities");
    const waiver = waivers.find(
      (w) =>
        String(w.receipt_line_id) === String(line.id) &&
        w.usage_fingerprint === usageFingerprint(u),
    );
    const unresolved =
      (damaged > 0 || missing > 0) &&
      (!waiver ||
        !waiver.vendor_no_charge ||
        Number(waiver.disposed_quantity) !== damaged - bad);
    return {
      ...line,
      ...u,
      receipt_line_id: line.id,
      returned_intact: good,
      returned_damaged: bad,
      remaining_intact: remaining,
      unresolved_exception: unresolved,
      disposed_quantity: waiver ? Number(waiver.disposed_quantity) : 0,
      billing_description: description(line),
      billable_quantity: used,
      line_amount: calculateLine({
        quantity: String(used),
        unit_price: String(line.unit_price),
      }).line_total,
    };
  });
}
function ready(lines, usages, returns, waivers) {
  const rows = reconcile(lines, usages, returns, waivers);
  if (
    !rows.length ||
    rows.some((r) => r.remaining_intact > 0 || r.unresolved_exception)
  )
    throw error(
      409,
      "Return all unused intact items and resolve every damaged/missing-item liability before confirming F20",
    );
  return rows;
}
const total = (lines) => addDecimal(...lines.map((l) => l.line_amount));
module.exports = {
  error,
  text,
  id,
  quantity,
  price,
  date,
  today,
  hash,
  role,
  scm,
  cmo,
  finance,
  canCreate,
  REASONS,
  PURPOSES,
  description,
  usageFingerprint,
  reconcile,
  ready,
  total,
  compareDecimal,
};
