"use strict";
const fail = (statusCode, message, code = "SCOP_INVALID") =>
  Object.assign(new Error(message), { statusCode, code });
const SOURCES = Object.freeze([
  "WAREHOUSE_STOCK",
  "CENTRAL_SUPPLY",
  "LOCAL_PROCUREMENT",
  "CONTRACT",
  "TRANSFER",
]);
const scaled = (value) => {
  // No coercion of booleans, exponent notation, NaN, or rounded decimal numbers.
  const input =
    typeof value === "string"
      ? value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
      : String(value);
  if (
    !["string", "number"].includes(typeof value) ||
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    !/^\d{1,18}(?:\.\d{1,6})?$/.test(input)
  )
    throw fail(
      400,
      "Use a non-negative decimal with at most six decimal places",
      "SCOP_QUANTITY_INVALID",
    );
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
};
const decimal = (value) => {
  const n = typeof value === "bigint" ? value : scaled(value);
  if (n < 0n)
    throw fail(409, "Conflicting negative quantity", "SCOP_EVIDENCE_CONFLICT");
  return `${n / 1000000n}.${String(n % 1000000n).padStart(6, "0")}`;
};
const positive = (value) => {
  const n = scaled(value);
  if (n === 0n)
    throw fail(400, "Quantity must be positive", "SCOP_QUANTITY_INVALID");
  return decimal(n);
};
const id = (value) => {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw fail(400, "A positive record ID is required");
  return String(Number(value));
};
const text = (value, field) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    throw fail(400, `${field} is required (maximum 2000 characters)`);
  return value.trim();
};
function capacity(ceiling, quantities) {
  if (quantities.reduce((n, q) => n + scaled(q), 0n) > scaled(ceiling))
    throw fail(
      409,
      "Allocations exceed the approved requirement",
      "SCOP_CAPACITY_EXCEEDED",
    );
}
function progress(allocated, facts) {
  const q = scaled(allocated),
    f = Object.fromEntries(
      [
        "ordered",
        "received",
        "accepted",
        "rejected",
        "short",
        "pending_inspection",
        "quarantined",
        "issued",
        "direct_accepted",
      ].map((k) => [k, scaled(facts[k] ?? "0")]),
    );
  // Rejected/replacement history can make gross receipts exceed allocated demand.
  const fulfilled = f.issued + f.direct_accepted;
  const conflict =
    fulfilled > q ||
    f.ordered > q ||
    f.accepted > q ||
    f.issued > q ||
    f.accepted + f.pending_inspection + f.quarantined > q ||
    f.accepted + f.rejected + f.short + f.pending_inspection + f.quarantined >
      f.received;
  return {
    ...Object.fromEntries(
      Object.entries(f).map(([k, v]) => [`${k}_quantity`, decimal(v)]),
    ),
    allocated_quantity: decimal(q),
    fulfilled_quantity: decimal(fulfilled),
    outstanding_quantity: decimal(fulfilled > q ? 0n : q - fulfilled),
    outstanding_acceptance_quantity: decimal(
      f.accepted > q ? 0n : q - f.accepted,
    ),
    evidence_conflict: conflict,
    sourcing_state:
      f.ordered >= q
        ? "ORDERED"
        : f.ordered > 0n
          ? "PARTIALLY_ORDERED"
          : "ALLOCATED",
    physical_state: conflict
      ? "EVIDENCE_CONFLICT"
      : fulfilled >= q
        ? "FULFILLED"
        : f.issued > 0n
          ? "PARTIALLY_ISSUED"
          : f.accepted >= q
            ? "ACCEPTED"
            : f.accepted > 0n
              ? "PARTIALLY_ACCEPTED"
              : f.pending_inspection > 0n
                ? "PENDING_INSPECTION"
                : f.quarantined > 0n
                  ? "QUARANTINED"
                  : f.received > 0n && f.rejected + f.short >= f.received
                    ? "REJECTED_OR_SHORT"
                    : f.received > 0n
                      ? "RECEIVED_UNAVAILABLE"
                      : "NOT_RECEIVED",
  };
}
module.exports = {
  fail,
  SOURCES,
  scaled,
  decimal,
  positive,
  id,
  text,
  capacity,
  progress,
};
