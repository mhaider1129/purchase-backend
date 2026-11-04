"use strict";
// Offline source inventory. Never import app/config/db or connect to a database.
const fs = require("node:fs"),
  path = require("node:path"),
  parser = require("@babel/parser");
const { extractBackendSqlContract } = require("./extractBackendSqlContract");
const root = path.resolve(__dirname, "../..");
const targets = new Set(
  "requests requested_items procurement_cases procurement_lifecycle_states procurement_state_history warehouse_supply_items warehouse_supplied_items goods_receipts goods_receipt_items technical_inspections delivery_inspection_tasks inventory_transactions inventory_transaction_allocations".split(
    " ",
  ),
);
const ranges = new Map();
function symbol(file, line) {
  if (!ranges.has(file)) {
    const found = [];
    const tree = parser.parse(fs.readFileSync(path.join(root, file), "utf8"), {
      sourceType: "unambiguous",
    });
    function visit(n, parent) {
      if (!n || typeof n !== "object") return;
      if (/Function/.test(n.type) || n.type === "ObjectMethod") {
        const name =
          n.id?.name ||
          (parent?.type === "VariableDeclarator" ? parent.id?.name : null) ||
          (parent?.type === "ObjectProperty" ? parent.key?.name : null) ||
          n.key?.name;
        if (name)
          found.push({ name, start: n.loc.start.line, end: n.loc.end.line });
      }
      for (const [k, v] of Object.entries(n)) {
        if (["loc", "comments", "tokens"].includes(k)) continue;
        if (Array.isArray(v)) v.forEach((x) => visit(x, n));
        else if (v && typeof v === "object") visit(v, n);
      }
    }
    visit(tree);
    ranges.set(file, found);
  }
  return (
    ranges
      .get(file)
      .filter((r) => r.start <= line && r.end >= line)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .map((r) => r.name)
      .join(".") || "<module>"
  );
}
function kind(file, fn) {
  if (/\/(?:tests|__tests__|integration)\//.test(file) || /\/scripts\/(?:testBackend|runP2P)/.test(file)) return "TEST_FIXTURE";
  if (file.endsWith(".sql")) return "MANUAL_SQL_DEPLOYMENT_UNVERIFIED";
  if (file.includes("/utils/ensure")) return "RUNTIME_SCHEMA_MAINTENANCE";
  if (
    fn.includes("addReceivedStockToWarehouse") ||
    fn.includes("insertInventoryTransaction")
  )
    return "UNUSED_COMPATIBILITY";
  if (file.endsWith("/controllers/utils/remindPendingReceipts.js"))
    return "ACTIVE_REMINDER_METADATA_ONLY";
  if (file.endsWith("/requestLifecycleService.js"))
    return "CANONICAL_REQUEST_TRANSITION";
  if (file.endsWith("/procurementPerformanceRepository.js"))
    return "DURABLE_CASE_PROJECTION";
  if (file.endsWith("/connectedP2PRepository.js"))
    return "CANONICAL_RECEIVING_PROJECTION";
  if (file.endsWith("/inventoryRepository.js"))
    return "CANONICAL_INVENTORY_LEDGER";
  return "REVIEWED_APPLICATION_MODULE";
}
function scan(readers = false) {
  const sites = [];
  const add = (file, line, sql, fn) => {
    for (const m of sql.matchAll(
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(\$\{[^}]+\}|[a-z_][a-z0-9_]*)/gi,
    )) {
      const table = m[2].toLowerCase();
      if (!targets.has(table) && !table.startsWith("${")) continue;
      sites.push({
        file,
        line,
        function: fn,
        operation: m[1].replace(/\s+/g, " ").toUpperCase(),
        table,
        classification: kind(file, fn),
        sql: sql.replace(/\s+/g, " ").trim(),
      });
    }
  };
  for (const row of extractBackendSqlContract(
    path.join(root, "purchase-backend"),
  ).sql) {
    const file = "purchase-backend/" + row.source;
    if (readers) {
      const tables = [
        ...row.value.matchAll(
          /\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
        ),
      ]
        .map((m) => m[1].toLowerCase())
        .filter((table) => targets.has(table));
      if (
        /\bSELECT\b/i.test(row.value) &&
        tables.length &&
        /status|complet|fulfill|received|quantity|procurement_state|closed_at/i.test(
          row.value,
        )
      )
        sites.push({
          file,
          line: row.line,
          function: symbol(file, row.line),
          operation: "READ",
          table: [...new Set(tables)].join(","),
          classification: kind(file, symbol(file, row.line)),
          queryCall: row.queryCall,
          sql: row.value.replace(/\s+/g, " ").trim(),
        });
    } else add(file, row.line, row.value, symbol(file, row.line));
  }
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        [
          ".git",
          "node_modules",
          "build",
          "coverage",
          ".agents",
          ".codex",
        ].includes(e.name)
      )
        continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".sql")) {
        const file = path.relative(root, full),
          sql = fs.readFileSync(full, "utf8");
        for (const m of sql.matchAll(
          /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?[a-z_][a-z0-9_]*[\s\S]*?;/gi,
        ))
          add(
            file,
            sql.slice(0, m.index).split("\n").length,
            m[0],
            "<manual SQL>",
          );
        for (const m of sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$;/gi,
        ))
          if (
            /NEW\.(?:status|completed_at|closed_at|is_received|received_quantity)\s*(?::=|=)/i.test(
              m[0],
            )
          )
            sites.push({
              file,
              line: sql.slice(0, m.index).split("\n").length,
              function: m[0].match(/FUNCTION\s+([^ (]+)/i)?.[1],
              operation: "TRIGGER_ROW_ASSIGNMENT",
              table: "<resolve trigger binding>",
              classification: "MANUAL_SQL_DEPLOYMENT_UNVERIFIED",
              sql: m[0].replace(/\s+/g, " "),
            });
      }
    }
  }
  if (!readers) walk(root);
  sites.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.table.localeCompare(b.table),
  );
  return {
    scope:
      "Offline literal/DML/trigger assignment inventory plus reviewed module classification. Dynamic assembly and hosted functions/trigger activation require owner review; reachability is documented in the companion authority matrix.",
    sites,
  };
}
if (require.main === module) {
  const r = scan(process.argv.includes("--readers"));
  process.stdout.write(
    process.argv.includes("--jsonl")
      ? r.sites.map((x) => JSON.stringify(x)).join("\n") + "\n"
      : JSON.stringify(r, null, 2) + "\n",
  );
}
module.exports = { scan };
