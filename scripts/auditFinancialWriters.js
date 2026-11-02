"use strict";
// Offline source inventory only: never import app/config/db, dotenv or a database client.
const fs = require("node:fs"),
  path = require("node:path");
const parser = require("@babel/parser");
const { extractBackendSqlContract } = require("./extractBackendSqlContract");
const root = path.resolve(__dirname, "../..");
const tables = new Set(
  "purchase_orders purchase_order_items goods_receipts goods_receipt_items procurement_awards requested_items procurement_item_events contract_items finance_action_history document_flow_links finance_chart_of_accounts finance_cost_centers contracts contract_invoices contract_payments contract_consumption supplier_invoices invoice_items invoice_match_results invoice_match_override_decisions ap_vouchers ap_voucher_lines ap_payables payment_records payment_allocations finance_postings journal_entries journal_entry_lines gl_postings gl_posting_lines budget_envelopes budget_lines commitment_ledger requested_item_financials procurement_lifecycle_states procurement_state_history audit_logs governance_audit_trail notification_outbox".split(
    " ",
  ),
);
const cache = new Map();
function symbol(file, line) {
  if (!cache.has(file)) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ranges = [];
    function visit(n, parent) {
      if (!n || typeof n !== "object") return;
      if (/Function/.test(n.type) || n.type === "ObjectMethod") {
        const name =
          n.id?.name ||
          (parent?.type === "VariableDeclarator" ? parent.id?.name : null) ||
          (parent?.type === "ObjectProperty" ? parent.key?.name : null) ||
          n.key?.name;
        if (name)
          ranges.push({ name, start: n.loc.start.line, end: n.loc.end.line });
      }
      for (const [key, value] of Object.entries(n)) {
        if (["loc", "comments", "tokens"].includes(key)) continue;
        if (Array.isArray(value)) for (const v of value) visit(v, n);
        else if (value && typeof value === "object") visit(value, n);
      }
    }
    visit(parser.parse(source, { sourceType: "unambiguous" }));
    cache.set(file, ranges);
  }
  return (
    cache
      .get(file)
      .filter((r) => r.start <= line && r.end >= line)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .map((r) => r.name)
      .join(".") || "<module>"
  );
}
function classify(file, fn, op) {
  if (
    file.startsWith("purchase-backend/sql/") ||
    file.includes("/migrations/") ||
    file.includes("/integration/fixtures/")
  )
    return {
      category: "E",
      reachability:
        "Manual migration/schema/maintenance source; not automatically applied or proof of hosted execution",
    };
  if (file.includes("/utils/ensure"))
    return {
      category: "E",
      reachability: file.includes("ensureProcureToPayTables")
        ? "Unreferenced runtime schema helper; no active callers found"
        : "Runtime schema/master maintenance; not settlement authority (call sites documented in report)",
    };
  if (file.endsWith("/requests/updateRequestsController.js"))
    return {
      category: "D",
      before: "B",
      reachability:
        "Active metadata hard-delete route; financial deletion/detachment is now blocked by retention before dynamic FK traversal",
    };
  if (file.endsWith("/contractAuthorizationService.js"))
    return {
      category: "A",
      reachability:
        "Trusted institute assignment on new roots, not settlement or history backfill",
    };
  if (file.endsWith("/writeAuditTrail.js"))
    return fn.includes("ensureAuditTable")
      ? { category: "E", reachability: "Active HTTP audit runtime DDL; not settlement authority" }
      : { category: "A", reachability: "Supplementary best-effort response-finish HTTP attempt audit, including 4xx; outside business transactions, not financial success evidence" };
  if (file.endsWith("/notificationOutboxProcessor.js"))
    return {
      category: "A",
      reachability:
        "Active delivery-state worker; changes outbox delivery metadata, never financial paid state",
    };
  if (
    file.endsWith("/procureToPayController.js") &&
    fn.includes("logFinanceAction")
  )
    return {
      category: "F",
      reachability:
        "Uncalled legacy audit/history helper; canonical services use auditService",
    };
  if (
    [
      "adminToolsController.js",
      "usersController.js",
      "requestWorkspaceController.js",
      "stockItemRequestRepository.js",
      "updateProcurementStatusController.js",
    ].some((name) => file.endsWith("/" + name))
  )
    return {
      category: "A",
      reachability:
        "Shared audit writer for account/request/procurement actions; no liability or settlement authority",
    };
  if (file.endsWith("/routes/procurementEvaluations.js"))
    return {
      category: "F",
      reachability:
        "Unmounted old generic evaluation router, not app.js mounted procurementEvaluationRoutes; no financial table callers",
    };
  if (file.endsWith("/itemMasterFoundationService.js"))
    return {
      category: "E",
      reachability:
        "Reference-master maintenance with fixed allowlists; no financial ledger targets",
    };
  if (file.endsWith("/attachmentsColumnSupport.js"))
    return {
      category: "E",
      reachability:
        "Attachment schema maintenance; generated identifier is not a financial ledger target",
    };
  if (file.endsWith("/approvalsController.js"))
    return {
      category: "A",
      reachability:
        "Existing approved-demand quantity/estimated total-cost writer, not AP or paid-value authority",
    };
  if (file.endsWith("/assignRequestController.js"))
    return {
      category: "E",
      reachability:
        "Active read-compatible assignment-column schema maintenance only",
    };
  if (
    file.endsWith("/procurementAssignmentService.js") ||
    file.endsWith("/procurementItemIdentityService.js") ||
    file.endsWith("/remindPendingReceipts.js")
  )
    return {
      category: "C",
      reachability:
        "Financial-amount read-only table-level candidate: changes assignment, identity or receipt flags, not ledger amounts or paid status",
    };
  if (file.endsWith("/financeCoreService.js"))
    return {
      category: "F",
      reachability:
        "Journal/accrual helpers exported/imported but no mounted invocation found; not activated",
    };
  if (file.endsWith("/requestedItemWriteService.js"))
    return {
      category: "A",
      reachability:
        "Canonical demand identity writer; cost/quantity fields are demand estimates, not AP or payments",
    };
  if (file.endsWith("/documentFlowService.js"))
    return {
      category: "A",
      reachability:
        "Canonical source-document provenance link writer; no amount posting or settlement",
    };
  if (file.endsWith("/connectedP2PRepository.js"))
    return fn.includes("updateInvoicePaymentState")
      ? {
          category: "F",
          reachability:
            "Repository helper has no production caller; canonical payment uses updateInvoicePaymentProjection",
        }
      : {
          category: "A",
          reachability:
            "Canonical connected service transaction; exact caller and route matrix in report",
        };
  if (file.endsWith("/contractsController.js")) {
    if (
      /createContractInvoice|updateContractInvoice|matchContractInvoice|runInvoiceMatch|updateContractInvoiceStatus|recalcInvoicePaymentStatus|createContractPayment|updateContractPayment|updateContractPaymentStatus|createContractConsumptionEntry/.test(
        fn,
      )
    )
      return {
        category: "D",
        before: "B",
        reachability:
          "Financial mutation blocked by Phase 5A policy after fresh authorization; historical GETs remain available",
      };
    return {
      category: "B",
      reachability:
        "Active commercial contract metadata/lifecycle writer; changed paid/consumed amounts quarantined, retained financial history cannot be deleted",
    };
  }
  if (file.endsWith("/contractGovernanceController.js"))
    return fn.includes("createContractPayment")
      ? {
          category: "D",
          before: "F",
          reachability:
            "Unmounted duplicate payment export; also blocked if directly invoked through its existing boundary",
        }
      : {
          category: "B",
          reachability:
            "Active commercial commitment/capacity metadata; not canonical AP or PO budget consumption",
        };
  if (
    file.endsWith("/requestedItemsController.js") ||
    file.endsWith("/requests/createRequestController.js") ||
    file.endsWith("/requests/procurementItemEventsController.js")
  )
    return {
      category: "B",
      reachability:
        "Active requested-item cost/paid/committed compatibility snapshot, not a canonical posted liability or settlement; left unchanged",
    };
  if (
    file.endsWith("/budgetControlController.js") ||
    file.endsWith("/auditService.js") ||
    file.endsWith("/notificationOutboxService.js") ||
    file.endsWith("/lifecycleTransitionService.js")
  )
    return {
      category: "A",
      reachability:
        "Existing scoped budget configuration or shared canonical audit/outbox/lifecycle writer; no new settlement authority",
    };
  return {
    category: "F",
    reachability:
      "Dynamic/unclassified source requires explicit call-graph review; not assumed active",
  };
}
function scan() {
  const sites = [];
  const add = (file, line, sql, fn) => {
    const seen = new Set();
    const re =
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE)\s+(?:public\.)?(\$\{[^}]+\}|[a-z_][a-z0-9_]*)/gi;
    for (const m of sql.matchAll(re)) {
      const target = m[2].toLowerCase();
      if (!tables.has(target) && !target.startsWith("${")) continue;
      const key = m[1] + target;
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push({
        file,
        line,
        function: fn,
        operation: m[1].replace(/\s+/g, " ").toUpperCase(),
        table: target,
        ...classify(file, fn, m[1]),
      });
    }
  };
  const source = extractBackendSqlContract(path.join(root, "purchase-backend"));
  for (const row of source.sql) {
    const file = "purchase-backend/" + row.source;
    add(file, row.line, row.value, symbol(file, row.line));
  }
  const files = [];
  function sqlFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        [
          ".git",
          "node_modules",
          "build",
          "coverage",
          ".agents",
          ".codex",
        ].includes(entry.name)
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sqlFiles(full);
      else if (entry.name.endsWith(".sql"))
        files.push(path.relative(root, full));
    }
  }
  sqlFiles(root);
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of text.matchAll(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE)\s+(?:public\.)?(?:\$\{[^}]+\}|[a-z_][a-z0-9_]*)/gi,
    ))
      add(
        file,
        text.slice(0, m.index).split("\n").length,
        m[0],
        "<manual SQL>",
      );
  }
  sites.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.table.localeCompare(b.table),
  );
  return {
    scope:
      "Offline lexical SQL-site inventory plus reviewed reachability; classifications do not establish hosted function/trigger state.",
    categories: {
      A: "Active canonical writer",
      B: "Active legacy/commercial compatibility writer",
      C: "Read-only projection (documented in authority report; no DML site)",
      D: "Disabled/deprecated financial mutation",
      E: "Historical migration or schema/maintenance utility",
      F: "Unreachable or uncertain code",
    },
    runtimeSqlLiterals: source.sql.length,
    sqlFilesScanned: files.length,
    sites,
  };
}
if (require.main === module) {
  const result = scan();
  process.stdout.write(
    process.argv.includes("--jsonl")
      ? result.sites.map((row) => JSON.stringify(row)).join("\n") + "\n"
      : JSON.stringify(result, null, 2) + "\n",
  );
}
module.exports = { scan, tables };
