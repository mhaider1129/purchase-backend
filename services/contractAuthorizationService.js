"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const database = require("../config/db");
const {
  getPermissionsForUserId,
  userHasPermission,
} = require("../utils/permissionService");
const {
  canUserDecideContractStep,
} = require("../policies/contractApprovalPolicy");
const audit = require("./auditService");
const storage = new AsyncLocalStorage();
const fail = (statusCode, message, code = "CONTRACT_ACCESS_DENIED") =>
  Object.assign(new Error(message), { statusCode, code });
const missing = () =>
  fail(404, "Contract or reference not found", "CONTRACT_NOT_FOUND");
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw fail(400, "A positive record ID is required");
  return Number(value);
};
const equal = (a, b) => a != null && b != null && String(a) === String(b);
const current = () => {
  const ctx = storage.getStore();
  if (!ctx) throw fail(503, "Authorized contract transaction required");
  return ctx;
};
const has = (a, permission) => userHasPermission(a, permission);
async function actor(
  input,
  client = database,
  lookup = getPermissionsForUserId,
) {
  if (!input?.id) throw fail(401, "Authentication required");
  const row = (
    await client.query(
      "SELECT id,role,institute_id,department_id,is_active FROM users WHERE id=$1 FOR SHARE",
      [id(input.id)],
    )
  ).rows[0];
  if (!row?.is_active || !row.institute_id)
    throw fail(403, "An active institute account is required");
  const grants = await lookup(row.id, client, { explicitGrants: true });
  if (!Array.isArray(grants?.permissions) || grants.found === false)
    throw fail(503, "Contract permissions unavailable");
  const result = {
    ...row,
    permissions: grants.permissions,
    data_scopes: grants.dataScopes || {},
  };
  result.hasPermission = (permission) => has(result, permission);
  return result;
}
function institutes(a) {
  const values = [id(a.institute_id)];
  // Reuse the existing contract-file cross-institute rule: both grant AND bounded scopes.
  if (has(a, "requests.cross-institute"))
    for (const value of a.data_scopes?.institute_ids || [])
      values.push(id(value));
  return [...new Set(values)];
}
const ownerSql = (a) =>
  `COALESCE(${a}.institute_id,(SELECT r.institute_id FROM requests r WHERE r.id=${a}.source_request_id),(SELECT d.institute_id FROM departments d WHERE d.id=${a}.end_user_department_id))`;
function ownership(a = "c") {
  const owner = ownerSql(a);
  return `${owner} IS NOT NULL AND (${a}.source_request_id IS NULL OR EXISTS(SELECT 1 FROM requests cr WHERE cr.id=${a}.source_request_id AND cr.institute_id=${owner})) AND (${a}.end_user_department_id IS NULL OR EXISTS(SELECT 1 FROM departments cd WHERE cd.id=${a}.end_user_department_id AND cd.institute_id=${owner})) AND (${a}.supplier_id IS NULL OR EXISTS(SELECT 1 FROM suppliers cs WHERE cs.id=${a}.supplier_id AND (cs.institute_id IS NULL OR cs.institute_id=${owner})))`;
}
function relationship(a, user) {
  if (has(user, "contracts.manage")) return "TRUE";
  const uid = id(user.id),
    dept = user.department_id ? id(user.department_id) : "NULL";
  // Role names apply only to an actual assigned workflow step, never a global role bypass.
  const aliases = require("../policies/contractApprovalPolicy").ROLE_ALIASES;
  const keys = Object.entries(aliases)
    .filter(([, roles]) =>
      roles.includes(
        String(user.role || "")
          .trim()
          .toLowerCase(),
      ),
    )
    .map(([key]) => `'${key}'`);
  return `(${a}.created_by=${uid} OR ${a}.contract_manager_id=${uid} OR EXISTS(SELECT 1 FROM contract_approvals cauth WHERE cauth.contract_id=${a}.id AND (cauth.is_active OR cauth.status IN ('Approved','Rejected')) AND (cauth.reviewer_department_id IS NULL OR cauth.reviewer_department_id=${dept}) AND (cauth.reviewer_id=${uid} OR (cauth.reviewer_id IS NULL AND cauth.reviewer_role IN (${keys.join(",") || "NULL"})))))`;
}
function integrity(a = "c") {
  const pairs = [
    ["contract_payments", "invoice_id", "contract_invoices"],
    [
      "contract_obligations",
      "generated_from_obligation_id",
      "contract_obligations",
    ],
    ["contract_consumption", "invoice_id", "contract_invoices"],
    ["contract_document_versions", "document_id", "contract_documents"],
    ["contract_ai_extractions", "document_id", "contract_documents"],
    [
      "contract_ai_extractions",
      "document_version_id",
      "contract_document_versions",
    ],
  ];
  const checks = pairs.map(
    ([left, column, right]) =>
      `NOT EXISTS(SELECT 1 FROM ${left} cl LEFT JOIN ${right} cr ON cr.id=cl.${column} WHERE cl.contract_id=${a}.id AND cl.${column} IS NOT NULL AND cr.contract_id IS DISTINCT FROM cl.contract_id)`,
  );
  for (const [column, table] of [
    ["item_id", "stock_items"],
    ["generic_item_id", "generic_items"],
    ["approved_product_id", "approved_products"],
  ]) {
    checks.push(
      `NOT EXISTS(SELECT 1 FROM contract_items ci LEFT JOIN ${table} cm ON cm.id=ci.${column} WHERE ci.contract_id=${a}.id AND ci.${column} IS NOT NULL AND (cm.id IS NULL OR (cm.institute_id IS NOT NULL AND cm.institute_id IS DISTINCT FROM ${ownerSql(a)})))`,
    );
  }
  checks.push(
    `NOT EXISTS(SELECT 1 FROM contract_items ci LEFT JOIN supplier_catalog_items cm ON cm.id=ci.supplier_catalog_item_id LEFT JOIN suppliers cs ON cs.id=cm.supplier_id WHERE ci.contract_id=${a}.id AND ci.supplier_catalog_item_id IS NOT NULL AND (cm.id IS NULL OR cs.id IS NULL OR (cm.contract_id IS NOT NULL AND cm.contract_id<>${a}.id) OR (${a}.supplier_id IS NOT NULL AND cm.supplier_id IS DISTINCT FROM ${a}.supplier_id) OR (cs.institute_id IS NOT NULL AND cs.institute_id IS DISTINCT FROM ${ownerSql(a)})))`,
  );
  checks.push(
    `NOT EXISTS(SELECT 1 FROM contract_documents cl LEFT JOIN contract_document_versions cr ON cr.id=cl.current_version_id WHERE cl.contract_id=${a}.id AND cl.current_version_id IS NOT NULL AND (cr.contract_id IS DISTINCT FROM cl.contract_id OR cr.document_id IS DISTINCT FROM cl.id))`,
  );
  return checks.join(" AND ");
}
function predicate(user, a = "c", catalog = false, delegation = null) {
  const delegated =
    delegation === "evaluation"
      ? `EXISTS(SELECT 1 FROM contract_evaluations cd WHERE cd.contract_id=${a}.id AND cd.evaluator_id=${id(user.id)})`
      : delegation === "obligation"
        ? `EXISTS(SELECT 1 FROM contract_obligations cd WHERE cd.contract_id=${a}.id AND cd.owner_user_id=${id(user.id)})`
        : "FALSE";
  return `(${ownership(a)} AND ${integrity(a)} AND ${ownerSql(a)} IN (${institutes(user).join(",")}) AND ${catalog ? "TRUE" : `(${relationship(a, user)} OR ${delegated})`})`;
}
const scope = (a = "c") => {
  const ctx = current();
  return `(${predicate(ctx.actor, a, ctx.catalog, ctx.delegation)}${ctx.financialRead ? ` AND ${ownerSql(a)}=${id(ctx.actor.institute_id)}` : ""})`;
};
function delegatedRowScope(table, actorColumn) {
  const ctx = current();
  return `(${table}.${actorColumn}=${id(ctx.actor.id)} OR EXISTS(SELECT 1 FROM contracts c WHERE c.id=${table}.contract_id AND ${predicate(ctx.actor)}))`;
}
const obligationScope = () =>
  delegatedRowScope("contract_obligations", "owner_user_id");
const evaluationScope = () => delegatedRowScope("ce", "evaluator_id");
const instituteSql = () => String(current().instituteId);
const departmentSql = () =>
  current().actor.department_id
    ? String(id(current().actor.department_id))
    : "NULL";
async function root(
  client,
  a,
  contractId,
  action = "read",
  lock = false,
  delegation = null,
) {
  const c = (
    await client.query(
      `SELECT c.*,${ownerSql("c")} AS resolved_institute_id FROM contracts c WHERE c.id=$1 AND ${predicate(a, "c", false, delegation)}${lock ? " FOR UPDATE OF c" : ""}`,
      [id(contractId)],
    )
  ).rows[0];
  if (!c) throw missing();
  if (c.source_request_id)
    await ownedReference(
      client,
      "requests",
      c.source_request_id,
      c.resolved_institute_id,
    );
  if (c.end_user_department_id)
    await ownedReference(
      client,
      "departments",
      c.end_user_department_id,
      c.resolved_institute_id,
    );
  if (c.supplier_id)
    await ownedReference(
      client,
      "suppliers",
      c.supplier_id,
      c.resolved_institute_id,
      false,
      true,
    );
  if (action === "manage" && !has(a, "contracts.manage"))
    throw fail(403, "Permission required: contracts.manage");
  return c;
}
const children = {
  documentId: "contract_documents",
  versionId: "contract_document_versions",
  obligationId: "contract_obligations",
  renewalEventId: "contract_renewal_events",
  invoiceId: "contract_invoices",
  paymentId: "contract_payments",
  approvalId: "contract_approvals",
  itemId: "contract_items",
  extractionId: "contract_ai_extractions",
  document_id: "contract_documents",
  evidence_document_id: "contract_documents",
  generated_from_obligation_id: "contract_obligations",
  document_version_id: "contract_document_versions",
  invoice_id: "contract_invoices",
  payment_id: "contract_payments",
  obligation_id: "contract_obligations",
  renewal_event_id: "contract_renewal_events",
};
async function child(client, table, value, contractId) {
  const row = (
    await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR SHARE`, [
      id(value),
    ])
  ).rows[0];
  if (!row || !equal(row.contract_id, contractId)) throw missing();
  return row;
}
async function references(client, ctx, value, parentDocumentId) {
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (v == null || v === "") continue;
    if (key === "institute_id" && !equal(v, ctx.instituteId))
      throw fail(
        400,
        "Contract institute cannot be supplied or changed",
        "CONTRACT_INSTITUTE_IMMUTABLE",
      );
    if (key === "contract_id" && !equal(v, ctx.contract?.id)) throw missing();
    const masters = {
      generic_item_id: "generic_items",
      approved_product_id: "approved_products",
      item_id: "stock_items",
    };
    if (masters[key])
      await ownedReference(
        client,
        masters[key],
        v,
        ctx.instituteId,
        false,
        true,
      );
    if (key === "supplier_catalog_item_id") {
      const row = (
        await client.query(
          "SELECT * FROM supplier_catalog_items WHERE id=$1 FOR SHARE",
          [id(v)],
        )
      ).rows[0];
      if (
        !row ||
        (row.contract_id != null &&
          !equal(row.contract_id, ctx.contract?.id)) ||
        (ctx.contract?.supplier_id &&
          !equal(row.supplier_id, ctx.contract.supplier_id))
      )
        throw missing();
      await ownedReference(
        client,
        "suppliers",
        row.supplier_id,
        ctx.instituteId,
        false,
        true,
      );
    }
    if (children[key]) {
      const table =
        key === "documentId" && ctx.action === "updateDocumentChecklist"
          ? "contract_required_documents"
          : children[key];
      const row = await child(client, table, v, ctx.contract?.id);
      if (table === "contract_document_versions") {
        const doc = await child(
          client,
          "contract_documents",
          row.document_id,
          ctx.contract.id,
        );
        if (parentDocumentId != null && !equal(doc.id, parentDocumentId))
          throw missing();
        if (value.document_id != null && !equal(doc.id, value.document_id))
          throw missing();
      }
    }
    if (
      key === "source_request_id" &&
      ctx.contract &&
      !equal(v, ctx.contract[key])
    )
      throw fail(
        409,
        "Contract source ownership cannot be changed",
        "CONTRACT_SOURCE_IMMUTABLE",
      );
    if (key === "source_request_id")
      await ownedReference(client, "requests", v, ctx.instituteId);
    if (
      [
        "end_user_department_id",
        "delivery_location_department_id",
        "main_technical_department_id",
        "owner_department_id",
        "reviewer_department_id",
        "department_id",
      ].includes(key)
    )
      await ownedReference(client, "departments", v, ctx.instituteId);
    if (["owner_user_id", "contract_manager_id", "evaluator_id"].includes(key))
      await ownedReference(client, "users", v, ctx.instituteId, !ctx.persisted);
    if (key === "technical_department_ids")
      for (const d of Array.isArray(v)
        ? v
        : String(v)
            .replace(/[\[\]{}]/g, "")
            .split(",")
            .filter(Boolean))
        await ownedReference(client, "departments", d, ctx.instituteId);
    if (key === "supplier_id") {
      await ownedReference(
        client,
        "suppliers",
        v,
        ctx.instituteId,
        false,
        true,
      );
      if (
        ctx.contract?.supplier_id &&
        /Invoice|Payment|Consumption/.test(ctx.action) &&
        !equal(v, ctx.contract.supplier_id)
      )
        throw missing();
    }
    if (["purchase_order_id", "po_id", "goods_receipt_id"].includes(key))
      await financialReference(client, ctx, key, v);
    if (key === "source_id" && value.source_type && v != null) {
      const kinds = {
        invoice: "invoice_id",
        purchase_order: "purchase_order_id",
        goods_receipt: "goods_receipt_id",
      };
      if (kinds[value.source_type] === "invoice_id")
        await child(client, "contract_invoices", v, ctx.contract.id);
      else if (kinds[value.source_type])
        await financialReference(client, ctx, kinds[value.source_type], v);
      else throw fail(400, "Unsupported linked financial source");
    }
    if (typeof v === "object")
      await references(client, ctx, v, parentDocumentId);
  }
}
async function ownedReference(
  client,
  table,
  value,
  instituteId,
  active = false,
  shared = false,
) {
  const row = (
    await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR SHARE`, [
      id(value),
    ])
  ).rows[0];
  if (
    !row ||
    (!equal(row.institute_id, instituteId) &&
      !(shared && row.institute_id == null)) ||
    (active && !row.is_active)
  )
    throw missing();
  return row;
}
async function financialReference(client, ctx, key, value) {
  if (ctx.persisted) {
    const table =
      key === "goods_receipt_id" ? "goods_receipts" : "purchase_orders";
    const row = (
      await client.query(
        `SELECT p.id,p.request_id,r.institute_id FROM ${table} p JOIN requests r ON r.id=p.request_id WHERE p.id=$1`,
        [id(value)],
      )
    ).rows[0];
    if (
      !row ||
      !equal(row.institute_id, ctx.instituteId) ||
      !equal(row.request_id, ctx.contract?.source_request_id)
    )
      throw missing();
    return;
  }
  const ref =
    key === "goods_receipt_id"
      ? { receiptId: value }
      : { purchaseOrderId: value };
  const auth = await require("./p2pAuthorization").authorizeCommand(
    { client },
    ctx.actor,
    "procure-to-pay.lifecycle.view",
    ref,
  );
  if (
    !equal(auth.instituteId, ctx.instituteId) ||
    !ctx.contract?.source_request_id ||
    !equal(auth.request?.id, ctx.contract.source_request_id)
  )
    throw missing();
}
// Validate persisted links too: no corrupted pointer may expose a foreign child's payload.
async function graph(client, ctx) {
  const contractId = ctx.contract.id;
  const rootRefs = {};
  const additional =
    typeof ctx.contract.clm_additional_payload === "string"
      ? JSON.parse(ctx.contract.clm_additional_payload)
      : ctx.contract.clm_additional_payload;
  if (additional?.delivery_location_department_id)
    rootRefs.delivery_location_department_id =
      additional.delivery_location_department_id;
  for (const key of [
    "contract_manager_id",
    "main_technical_department_id",
    "technical_department_ids",
    "secondary_technical_reviews",
  ])
    if (ctx.contract[key] != null) rootRefs[key] = ctx.contract[key];
  await references(client, { ...ctx, persisted: true }, rootRefs);
  const inconsistent = (
    await client.query(
      `SELECT 1 FROM contract_payments p LEFT JOIN contract_invoices i ON i.id=p.invoice_id WHERE p.invoice_id IS NOT NULL AND (p.contract_id=$1 OR i.contract_id=$1) AND p.contract_id IS DISTINCT FROM i.contract_id
    UNION ALL SELECT 1 FROM contract_consumption p LEFT JOIN contract_invoices i ON i.id=p.invoice_id WHERE p.invoice_id IS NOT NULL AND (p.contract_id=$1 OR i.contract_id=$1) AND p.contract_id IS DISTINCT FROM i.contract_id LIMIT 1`,
      [contractId],
    )
  ).rowCount;
  if (inconsistent) throw missing();
  for (const table of [
    "contract_items",
    "contract_documents",
    "contract_document_versions",
    "contract_obligations",
    "contract_renewal_events",
    "contract_invoices",
    "contract_payments",
    "contract_consumption",
    "contract_ai_extractions",
  ]) {
    const rows = (
      await client.query(
        `SELECT * FROM ${table} WHERE contract_id=$1 ORDER BY id FOR SHARE`,
        [contractId],
      )
    ).rows;
    for (const row of rows) {
      const refs = {};
      for (const key of [
        "generic_item_id",
        "approved_product_id",
        "supplier_catalog_item_id",
        "item_id",
        "document_id",
        "document_version_id",
        "evidence_document_id",
        "generated_from_obligation_id",
        "invoice_id",
        "supplier_id",
        "owner_user_id",
        "owner_department_id",
      ])
        if (row[key] != null) refs[key] = row[key];
      if (row.source_id != null) {
        refs.source_id = row.source_id;
        refs.source_type = row.source_type;
      }
      if (row.current_version_id != null) {
        const version = await child(
          client,
          "contract_document_versions",
          row.current_version_id,
          contractId,
        );
        if (!equal(version.document_id, row.id)) throw missing();
      }
      await references(
        client,
        { ...ctx, persisted: true },
        refs,
        table === "contract_document_versions" ? row.document_id : undefined,
      );
    }
  }
}
async function ensureSchema() {
  const client = current().client;
  // A read-only readiness check replaces global request-time DDL and data normalization.
  await client.query("SELECT institute_id FROM contracts LIMIT 0");
  await client.query(
    "SELECT generated_from_obligation_id FROM contract_obligations LIMIT 0",
  );
}
const db = {
  async query(sql, values) {
    const ctx = current();
    const command = typeof sql === "string" ? sql.trim() : sql.text?.trim();
    // Compose legacy controllers with the outer canonical transaction. They may not commit it.
    if (/^(BEGIN|COMMIT)(?:\s*;)?$/i.test(command))
      return { rows: [], rowCount: 0 };
    if (/^ROLLBACK(?:\s*;)?$/i.test(command)) {
      ctx.failed ||= fail(500, "Contract transaction rolled back");
      return { rows: [], rowCount: 0 };
    }
    try {
      return await ctx.client.query(sql, values);
    } catch (error) {
      if (
        /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:contract_logs|audit_logs)\b/i.test(
          command,
        )
      )
        ctx.failed = error;
      throw error;
    }
  },
  async connect() {
    return { query: db.query, release() {} };
  },
};
async function snapshot(client, contractId, includeLogs = false) {
  const contract =
    (await client.query("SELECT * FROM contracts WHERE id=$1", [contractId]))
      .rows[0] || null;
  const evidence = { contract };
  if (includeLogs)
    evidence.contract_logs = (
      await client.query(
        "SELECT * FROM contract_logs WHERE contract_id=$1 ORDER BY id",
        [contractId],
      )
    ).rows;
  for (const table of [
    "contract_items",
    "contract_approvals",
    "contract_documents",
    "contract_document_versions",
    "contract_obligations",
    "contract_renewal_events",
    "contract_amendments",
    "contract_invoices",
    "contract_payments",
    "contract_consumption",
    "contract_required_documents",
    "contract_risk_assessments",
    "contract_ai_extractions",
    "contract_evaluations",
  ])
    evidence[table] = (
      await client.query(
        `SELECT * FROM ${table} WHERE contract_id=$1 ORDER BY id`,
        [contractId],
      )
    ).rows;
  return evidence;
}
const financial =
  /(?:Invoice|Payment|FinancialSummary|ConsumptionEntries|ConsumptionEntry)/;
const mutations =
  /^(create|update|patch|delete|archive|unarchive|renew|submit|decide|complete|waive|cancel|add|mark|match|recalculate|requestContractAi)/;
function wrap(name, handler, pool = database, options = {}) {
  return async (req, res, next) => {
    let client;
    const ctx = { action: name };
    let output;
    const deferred = new Proxy(res, {
      get(target, key) {
        if (["json", "send", "end"].includes(key))
          return (...args) => {
            output = { key, args };
            return deferred;
          };
        const value = target[key];
        return typeof value === "function"
          ? (...args) => {
              const result = value.apply(target, args);
              return result === target ? deferred : result;
            }
          : value;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    try {
      client = await pool.connect();
      ctx.client = client;
      await client.query("BEGIN");
      ctx.actor = await actor(req.user, client);
      ctx.catalog =
        name === "listActiveContractItems" &&
        (has(ctx.actor, "stock-requests.create") ||
          has(ctx.actor, "requests.manage"));
      ctx.instituteId = id(ctx.actor.institute_id);
      ctx.delegation = options.evaluation
        ? "evaluation"
        : /^(getContractObligation|listContractObligations|completeContractObligation|listDueSoonContractObligations)$/.test(
              name,
            )
          ? "obligation"
          : null;
      let evaluation;
      if (options.evaluation && req.params?.id) {
        evaluation = (
          await client.query(
            "SELECT * FROM contract_evaluations WHERE id=$1 FOR SHARE",
            [id(req.params.id)],
          )
        ).rows[0];
        if (!evaluation) throw missing();
      }
      const contractId = options.library
        ? null
        : options.evaluation
          ? (evaluation?.contract_id ??
            req.body?.contract_id ??
            req.query?.contract_id)
          : (req.params?.contractId ?? req.params?.id);
      if (options.library && !has(ctx.actor, "contracts.manage"))
        throw fail(403, "Permission required: contracts.manage");
      const write = mutations.test(name);
      ctx.financialRead =
        financial.test(name) ||
        /ContractRisk|HighRiskContracts|ContractHealth/.test(name);
      if (ctx.financialRead) {
        const capability =
          !write || !financial.test(name)
            ? "procure-to-pay.lifecycle.view"
            : /Payment/.test(name)
              ? "finance.payment.manage"
              : "procure-to-pay.invoices.manage";
        if (!has(ctx.actor, capability))
          throw fail(403, `Permission required: ${capability}`);
        // Existing request cross-institute overrides do not confer finance authority.
      }
      if (contractId != null) {
        const manage =
          (write &&
            ![
              "decideContractApproval",
              "completeContractObligation",
              "updateContractEvaluation",
            ].includes(name)) ||
          financial.test(name) ||
          name === "getContractRisk";
        ctx.contract = await root(
          client,
          ctx.actor,
          contractId,
          manage ? "manage" : "read",
          true,
          ctx.delegation,
        );
        ctx.instituteId = id(ctx.contract.resolved_institute_id);
        if (
          ctx.financialRead &&
          !equal(ctx.actor.institute_id, ctx.instituteId)
        )
          throw missing();
        ctx.delegatedOnly =
          ctx.delegation &&
          !(
            await client.query(
              `SELECT c.id FROM contracts c WHERE c.id=$1 AND ${predicate(ctx.actor)}`,
              [ctx.contract.id],
            )
          ).rowCount;
        if (
          ctx.delegatedOnly &&
          ctx.delegation === "obligation" &&
          req.params?.obligationId
        ) {
          const own = await child(
            client,
            "contract_obligations",
            req.params.obligationId,
            ctx.contract.id,
          );
          if (!equal(own.owner_user_id, ctx.actor.id)) throw missing();
        }
        await graph(client, ctx);
      } else if (
        write ||
        /RiskDashboard|HighRisk|ApprovalStageMonitor/.test(name)
      ) {
        if (!has(ctx.actor, "contracts.manage"))
          throw fail(403, "Permission required: contracts.manage");
      }
      // Header balance fields are another legacy financial writer. Apply the
      // same capabilities as the invoice/payment routes without changing AUD-001 settlement semantics.
      if (
        [
          "createContract",
          "updateContract",
          "updateContractGovernanceFields",
        ].includes(name)
      ) {
        for (const [field, capability] of [
          ["amount_paid", "finance.payment.manage"],
          ["actual_consumed_value", "procure-to-pay.invoices.manage"],
        ]) {
          if (
            req.body?.[field] != null &&
            Number(req.body[field]) !== Number(ctx.contract?.[field] || 0)
          ) {
            ctx.financialHeader = true;
            if (!has(ctx.actor, capability))
              throw fail(403, `Permission required: ${capability}`);
            if (ctx.contract && !equal(ctx.actor.institute_id, ctx.instituteId))
              throw missing();
          }
        }
      }
      if (name === "createContract") {
        // An existing request/department supplies ownership; a new standalone root belongs to the actor.
        const owners = [];
        for (const [key, table] of [
          ["source_request_id", "requests"],
          ["end_user_department_id", "departments"],
        ])
          if (req.body?.[key]) {
            const row = (
              await client.query(
                `SELECT institute_id FROM ${table} WHERE id=$1 FOR SHARE`,
                [id(req.body[key])],
              )
            ).rows[0];
            if (
              !row?.institute_id ||
              !institutes(ctx.actor).includes(id(row.institute_id))
            )
              throw missing();
            owners.push(id(row.institute_id));
          }
        if (new Set(owners).size > 1) throw missing();
        ctx.instituteId = owners[0] || ctx.instituteId;
        if (
          ctx.financialHeader &&
          !equal(ctx.actor.institute_id, ctx.instituteId)
        )
          throw missing();
      }
      if (
        evaluation &&
        !has(ctx.actor, "contracts.manage") &&
        !equal(evaluation.evaluator_id, ctx.actor.id)
      )
        throw fail(403, "Not the assigned evaluator");
      await references(
        client,
        ctx,
        options.library || options.evaluation ? {} : req.params,
        req.params?.documentId,
      );
      await references(client, ctx, req.body, req.params?.documentId);
      if (name === "decideContractApproval") {
        const step = await child(
          client,
          "contract_approvals",
          req.params.approvalId,
          ctx.contract.id,
        );
        if (
          !step.is_active ||
          step.status !== "Pending" ||
          !canUserDecideContractStep(ctx.actor, step) ||
          (step.reviewer_department_id &&
            !equal(step.reviewer_department_id, ctx.actor.department_id))
        )
          throw fail(403, "Not the authorized active contract reviewer");
      }
      if (name === "completeContractObligation") {
        const obligation = await child(
          client,
          "contract_obligations",
          req.params.obligationId,
          ctx.contract.id,
        );
        if (
          !has(ctx.actor, "contracts.manage") &&
          !equal(obligation.owner_user_id, ctx.actor.id)
        )
          throw fail(403, "Not the obligation owner");
      }
      if (
        name === "submitContractReview" &&
        !["draft", "under_review"].includes(ctx.contract.status)
      )
        throw fail(409, "Contract is not eligible for submission");
      if (
        name === "submitContractReview" &&
        (
          await client.query(
            "SELECT 1 FROM contract_approvals WHERE contract_id=$1 AND (is_active OR status='Approved') LIMIT 1",
            [ctx.contract.id],
          )
        ).rowCount
      )
        throw fail(409, "Existing review evidence must be preserved");
      if (
        name === "updateContract" &&
        req.body?.status &&
        !["draft", "terminated", "archived", ctx.contract.status].includes(
          req.body.status,
        )
      ) {
        if (
          (
            await client.query(
              "SELECT 1 FROM contract_approvals WHERE contract_id=$1 AND status<>'Approved' LIMIT 1",
              [ctx.contract.id],
            )
          ).rowCount
        )
          throw fail(
            409,
            "Complete the existing contract approval workflow first",
          );
      }
      if (name === "deleteContract") {
        const retained = (
          await client.query(
            `SELECT EXISTS(SELECT 1 FROM contract_documents WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_approvals WHERE contract_id=$1 AND status='Approved') OR EXISTS(SELECT 1 FROM contract_invoices WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_payments WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM attachments WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_amendments WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_document_versions WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_legal_reviews WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_negotiations WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_versions WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_obligations WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_renewal_events WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_evaluations WHERE contract_id=$1) OR EXISTS(SELECT 1 FROM contract_consumption WHERE contract_id=$1) AS retained`,
            [ctx.contract.id],
          )
        ).rows[0];
        if (
          retained.retained ||
          ctx.contract.status !== "draft" ||
          ctx.contract.is_historical_contract ||
          ctx.contract.signing_date
        )
          throw fail(
            409,
            "Contract contains retained business evidence; archive it instead",
          );
      }
      if (options.library && write && req.params?.id)
        ctx.libraryBefore = (
          await client.query(
            `SELECT * FROM ${/Template/.test(name) ? "contract_templates" : "contract_clauses"} WHERE id=$1`,
            [id(req.params.id)],
          )
        ).rows[0];
      const before = ctx.contract
        ? await snapshot(client, ctx.contract.id, name === "deleteContract")
        : null;
      req.user = ctx.actor;
      await storage.run(ctx, () =>
        handler(req, deferred, (error) => {
          throw error || fail(500, "Contract handler did not complete");
        }),
      );
      if (ctx.failed) throw ctx.failed;
      if (!output)
        throw fail(500, "Contract handler did not return a response");
      if (name === "createContract") {
        const created = output.args[0];
        const createdId = id(created?.id ?? created?.contract?.id);
        await client.query("UPDATE contracts SET institute_id=$1 WHERE id=$2", [
          ctx.instituteId,
          createdId,
        ]);
        ctx.contract = await root(client, ctx.actor, createdId, "manage");
      }
      if (options.library && write)
        await audit.writeAuditEvent({
          client,
          entityType: "contract_library",
          entityId: req.params?.id || output.args[0]?.id || name,
          action: `CONTRACT_${name}`,
          actorUserId: ctx.actor.id,
          instituteId: ctx.instituteId,
          beforeData: ctx.libraryBefore || null,
          afterData: output.args[0],
          metadata: { sharedLibrary: true },
        });
      if (ctx.contract) {
        if (name !== "deleteContract") {
          ctx.contract = await root(
            client,
            ctx.actor,
            ctx.contract.id,
            "read",
            false,
            ctx.delegation,
          );
          await graph(client, ctx);
        }
        const after = await snapshot(client, ctx.contract.id);
        if (write || JSON.stringify(before) !== JSON.stringify(after))
          await audit.writeAuditEvent({
            client,
            entityType: "contract",
            entityId: ctx.contract.id,
            action: `CONTRACT_${name}`,
            actorUserId: ctx.actor.id,
            instituteId: ctx.instituteId,
            requestId: ctx.contract.source_request_id,
            beforeData: before,
            afterData: after,
            metadata: { source: "contracts", params: req.params },
            reason: req.body?.reason || req.body?.decision_notes || null,
          });
      }
      await client.query("COMMIT");
      res.set?.("Cache-Control", "private, no-store");
      return res[output.key](...output.args);
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally {
      client?.release();
    }
  };
}
module.exports = {
  actor,
  root,
  predicate,
  ownership,
  ownerSql,
  scope,
  instituteSql,
  departmentSql,
  wrap,
  db,
  ensureSchema,
  references,
  graph,
  obligationScope,
  evaluationScope,
};
