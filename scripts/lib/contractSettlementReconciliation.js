"use strict";
// No app/config/db/dotenv import and no connection creation. Owner-facing diagnostic only.
const fs = require("node:fs");
const path = require("node:path");
const SQL = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../sql/reports/aud001_phase5a_reconciliation.sql",
  ),
  "utf8",
);
async function collect(client, { instituteId, includeUnowned = false } = {}) {
  if (!Number.isSafeInteger(instituteId) || instituteId < 1)
    throw new TypeError("An explicit positive institute ID is required");
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const mode = (await client.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only;
    if (mode !== "on")
      throw new Error("Read-only reconciliation transaction required");
    return {
      instituteId,
      includeUnowned,
      rows: (await client.query(SQL, [instituteId, Boolean(includeUnowned)]))
        .rows,
      limitations: [
        "Candidate matches are evidence for human reconciliation, not settlement instructions.",
        "No cross-ledger identity is inferred from an amount, date or name alone.",
        "No bank settlement, credit-note or installment deduplication is certified.",
      ],
    };
  } finally {
    await client.query("ROLLBACK");
  }
}
module.exports = { collect, SQL };
