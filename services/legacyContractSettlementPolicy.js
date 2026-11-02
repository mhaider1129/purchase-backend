"use strict";
// Phase 5A containment, not a source adapter or a settlement cutover.
const MUTATIONS = new Set([
  "createContractInvoice",
  "updateContractInvoice",
  "matchContractInvoice",
  "updateContractInvoiceStatus",
  "createContractPayment",
  "updateContractPayment",
  "updateContractPaymentStatus",
  "createContractConsumptionEntry",
]);
const CODE = "LEGACY_CONTRACT_FINANCIAL_MIGRATION_REQUIRED";
const MESSAGE =
  "Contract financial history is read-only pending reconciliation. For eligible new transactions, use the canonical invoice, verified voucher, posted payable and payment workflow. No legacy record has been migrated.";
const blocked = () =>
  Object.assign(new Error(MESSAGE), {
    statusCode: 410,
    code: CODE,
    details: {
      historicalRecords: "preserved",
      automaticMigration: false,
      supportedPaymentRoute:
        "POST /api/procure-to-pay/accounts-payable/:payableId/payments",
      prerequisite:
        "An independently verified and posted canonical AP payable with a reconciled source; do not recreate a previously settled obligation.",
    },
  });
// Exact equality only, without rounding/truncation or floating point conversion.
// This permits metadata saves carrying an unchanged stored amount, not a writer.
function amountIdentity(value) {
  if (value == null || value === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) return Symbol("invalid amount");
  const whole = BigInt(match[2]).toString();
  const fraction = (match[3] || "").replace(/0+$/, "");
  return `${match[1] && (whole !== "0" || fraction) ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}
function assertAllowed({ name, body = {}, contract = null, actor }) {
  if (MUTATIONS.has(name)) throw blocked();
  if (!["createContract", "updateContract", "renewContract"].includes(name))
    return;
  for (const [field, permission] of [
    ["amount_paid", "finance.payment.manage"],
    ["actual_consumed_value", "procure-to-pay.invoices.manage"],
  ]) {
    if (
      !Object.hasOwn(body, field) ||
      (name === "renewContract" && field !== "amount_paid")
    )
      continue;
    // Renewal uses COALESCE; null/blank is an explicit no-op there.
    if (name === "renewContract" && (body[field] == null || body[field] === ""))
      continue;
    const requested = amountIdentity(body[field]);
    const unchanged = contract
      ? requested === amountIdentity(contract[field])
      : requested == null || requested === "0";
    if (unchanged) continue;
    if (!actor?.hasPermission?.(permission))
      throw Object.assign(new Error(`Permission required: ${permission}`), {
        statusCode: 403,
        code: "CONTRACT_ACCESS_DENIED",
      });
    if (
      contract &&
      String(actor.institute_id) !== String(contract.resolved_institute_id)
    )
      throw Object.assign(new Error("Contract or reference not found"), {
        statusCode: 404,
        code: "CONTRACT_NOT_FOUND",
      });
    throw blocked();
  }
}
module.exports = { assertAllowed, blocked, MUTATIONS, CODE, MESSAGE };
