"use strict";
// Hard-delete must not erase a financial ledger or detach its source provenance.
// Missing modules contain no rows; this check performs no schema initialization.
const TABLES = [
  "supplier_invoices",
  "ap_vouchers",
  "finance_postings",
  "ap_payables",
  "payment_records",
  "commitment_ledger",
  "journal_entries",
  "gl_postings",
];
async function assertRequestDeletable(client, requestId) {
  const available = new Set(
    (
      await client.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND c.relname=ANY($1::text[])",
        [
          TABLES.concat([
            "purchase_orders",
            "contracts",
            "contract_invoices",
            "contract_payments",
            "contract_consumption",
            "requested_item_financials",
          ]),
        ],
      )
    ).rows.map((r) => r.relname),
  );
  const retained = () =>
    Object.assign(
      new Error(
        "Request contains retained financial history. Preserve it for reconciliation; financial records cannot be hard-deleted or detached.",
      ),
      { statusCode: 409, code: "FINANCIAL_HISTORY_RETAINED" },
    );
  for (const table of TABLES) {
    if (
      available.has(table) &&
      (
        await client.query(
          `SELECT 1 FROM ${table} WHERE request_id=$1 LIMIT 1`,
          [requestId],
        )
      ).rowCount
    )
      throw retained();
  }
  const nonzero = (field) =>
    `(NULLIF(BTRIM(to_jsonb(t)->>'${field}'),'') IS NOT NULL AND (to_jsonb(t)->>'${field}') !~ '^-?0+(\\.0+)?$')`;
  if (
    available.has("requested_item_financials") &&
    (
      await client.query(
        `SELECT 1 FROM requested_item_financials t WHERE request_id=$1 AND (${nonzero("paid_cost")} OR ${nonzero("committed_cost")} OR NULLIF(BTRIM(to_jsonb(t)->>'invoice_number'),'') IS NOT NULL OR NULLIF(BTRIM(to_jsonb(t)->>'po_number'),'') IS NOT NULL) LIMIT 1`,
        [requestId],
      )
    ).rowCount
  )
    throw retained();
  if (available.has("contracts")) {
    if (available.has("purchase_orders") && (await client.query("SELECT 1 FROM contracts c JOIN purchase_orders p ON (to_jsonb(p)->>'contract_id')=c.id::text WHERE c.source_request_id=$1 LIMIT 1",[requestId])).rowCount) throw retained();

    const linked = [
      "contract_invoices",
      "contract_payments",
      "contract_consumption",
    ]
      .filter((t) => available.has(t))
      .map(
        (table) => `EXISTS(SELECT 1 FROM ${table} f WHERE f.contract_id=t.id)`,
      );
    if (
      (
        await client.query(
          `SELECT 1 FROM contracts t WHERE (to_jsonb(t)->>'source_request_id')=$1::text AND (${[nonzero("amount_paid"), nonzero("actual_consumed_value"), ...linked].join(" OR ")}) LIMIT 1`,
          [requestId],
        )
      ).rowCount
    )
      throw retained();
  }
}
module.exports = { assertRequestDeletable };
