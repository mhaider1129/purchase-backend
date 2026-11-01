"use strict";
const {
  getPermissionsForUserId,
  userHasPermission,
} = require("../utils/permissionService");
const fail = (statusCode, message, code = "FINANCIAL_ACCESS_DENIED") =>
  Object.assign(new Error(message), { statusCode, code });
const missing = () => fail(404, "Financial document or reference not found");
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw fail(400, "A positive document ID is required");
  return String(Number(value));
};
const TABLES = {
  request: "requests",
  purchaseOrder: "purchase_orders",
  poLine: "purchase_order_items",
  award: "procurement_awards",
  item: "requested_items",
  receipt: "goods_receipts",
  receiptLine: "goods_receipt_items",
  invoice: "supplier_invoices",
  invoiceLine: "invoice_items",
  match: "invoice_match_results",
  voucher: "ap_vouchers",
  financePosting: "finance_postings",
  payable: "ap_payables",
  payment: "payment_records",
  commitment: "commitment_ledger",
  budget: "budget_envelopes",
};
const REFERENCES = {
  requestId: "request",
  purchaseOrderId: "purchaseOrder",
  invoiceId: "invoice",
  voucherId: "voucher",
  payableId: "payable",
  matchResultId: "match",
  receiptId: "receipt",
  paymentId: "payment",
  financePostingId: "financePosting",
  budgetId: "budget",
  commitmentId: "commitment",
};
async function loadActor(client, input, capability) {
  if (!input?.id) throw fail(401, "Authentication required");
  if (!client?.query)
    throw fail(503, "Transactional financial authorization unavailable");
  const user = (
    await client.query(
      "SELECT id,role,institute_id,department_id,warehouse_id,is_active FROM users WHERE id=$1 FOR SHARE",
      [id(input.id)],
    )
  ).rows[0];
  if (
    !user?.is_active ||
    !Number.isSafeInteger(Number(user.institute_id)) ||
    Number(user.institute_id) < 1
  )
    throw fail(403, "An active institute account is required");
  const grants = await getPermissionsForUserId(user.id, client, {
    explicitGrants: true,
  });
  if (!Array.isArray(grants?.permissions) || grants.found === false)
    throw fail(503, "Financial permissions unavailable");
  const actor = {
    ...user,
    permissions: grants.permissions,
    data_scopes: grants.dataScopes || {},
  };
  const capabilities = Array.isArray(capability) ? capability : [capability];
  if (
    !capabilities.length ||
    !capabilities.some(
      (code) => typeof code === "string" && userHasPermission(actor, code),
    )
  )
    throw fail(403, `Permission required: ${capabilities.join(" or ")}`);
  // There is no finance cross-institute capability in the existing catalog.
  // Request/inventory overrides and institute filter values cannot grant it.
  return actor;
}
const equal = (a, b) => a != null && b != null && String(a) === String(b);
async function authorizeCommand(tx, input, capability, refs = {}) {
  const client = tx?.client;
  const actor = await loadActor(client, input, capability);
  const roots = [];
  for (const [key, kind] of Object.entries(REFERENCES))
    if (refs[key] != null) roots.push({ kind, id: id(refs[key]) });
  for (const value of refs.awardIds || [])
    roots.push({ kind: "award", id: id(value) });
  let taskReference = null;
  const taskQuery = `SELECT t.id,t.institute_id,t.request_id,t.department_id,t.receipt_item_id,gr.id AS receipt_id,gr.request_id AS receipt_request_id FROM delivery_inspection_tasks t JOIN goods_receipt_items gri ON gri.id=t.receipt_item_id JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id WHERE t.id=$1`;
  if (refs.taskId != null) {
    taskReference = (await client.query(taskQuery, [id(refs.taskId)])).rows[0];
    if (!taskReference) throw missing();
    roots.push({ kind: "receipt", id: id(taskReference.receipt_id) });
  }
  let requestId = refs.requestId == null ? null : id(refs.requestId);
  const discover = async (kind, value) => {
    const row = (
      await client.query(`SELECT * FROM ${TABLES[kind]} WHERE id=$1`, [value])
    ).rows[0];
    if (!row) throw missing();
    if (kind === "request") return row.id;
    if (row.request_id != null) return row.request_id;
    if (kind === "budget") return null;
    throw missing();
  };
  for (const root of roots) {
    const owner = await discover(root.kind, root.id);
    if (owner != null) {
      if (requestId != null && !equal(requestId, owner)) throw missing();
      requestId = String(owner);
    }
  }
  let request = null;
  if (requestId != null) {
    request = (
      await client.query("SELECT * FROM requests WHERE id=$1 FOR UPDATE", [
        requestId,
      ])
    ).rows[0];
    if (!request || !equal(request.institute_id, actor.institute_id))
      throw missing();
  }
  if (taskReference) {
    const current = (
      await client.query(taskQuery + " FOR UPDATE OF t", [id(refs.taskId)])
    ).rows[0];
    if (
      !current ||
      !equal(current.institute_id, actor.institute_id) ||
      !equal(current.request_id, request?.id) ||
      !equal(current.receipt_request_id, request?.id) ||
      !equal(current.department_id, request?.department_id) ||
      !equal(current.receipt_item_id, taskReference.receipt_item_id)
    )
      throw missing();
  }
  const seen = new Map();
  const department = async (value) => {
    const d = (
      await client.query(
        "SELECT id,institute_id FROM departments WHERE id=$1 FOR SHARE",
        [value],
      )
    ).rows[0];
    if (!d || !equal(d.institute_id, actor.institute_id)) throw missing();
    return d;
  };
  const project = async (value) => {
    if (value == null) return;
    const p = (
      await client.query("SELECT * FROM projects WHERE id=$1 FOR SHARE", [
        value,
      ])
    ).rows[0];
    // Projects are shared UUID masters in the existing schema. A future explicit
    // owner is restrictive; ownership of budgets still comes from department.
    if (
      !p ||
      (p.institute_id != null && !equal(p.institute_id, actor.institute_id))
    )
      throw missing();
  };
  const supplier = async (value) => {
    const s = (
      await client.query("SELECT * FROM suppliers WHERE id=$1 FOR SHARE", [
        value,
      ])
    ).rows[0];
    if (
      !s ||
      (s.institute_id != null && !equal(s.institute_id, actor.institute_id))
    )
      throw missing();
    return s;
  };
  const link = (value, expected) => {
    if (!equal(value, expected)) throw missing();
  };
  const children = async (kind, column, parent) => {
    const rows = (
      await client.query(
        `SELECT id FROM ${TABLES[kind]} WHERE ${column}=$1 ORDER BY id`,
        [parent],
      )
    ).rows;
    for (const row of rows) await visit(kind, row.id);
  };
  async function visit(kind, value) {
    if (kind === "request" && !equal(value, request?.id)) throw missing();
    const key = `${kind}:${value}`;
    if (seen.has(key)) return seen.get(key);
    const row =
      kind === "request"
        ? request
        : (
            await client.query(
              `SELECT * FROM ${TABLES[kind]} WHERE id=$1 ${kind === "item" ? "FOR SHARE" : "FOR UPDATE"}`,
              [value],
            )
          ).rows[0];
    if (!row) throw missing();
    seen.set(key, row);
    if (row.request_id != null) {
      if (!request) throw missing();
      link(row.request_id, request.id);
    }
    if (
      row.institute_id != null &&
      !equal(row.institute_id, actor.institute_id)
    )
      throw missing();
    if (kind === "request") {
      await department(row.department_id);
      await project(row.project_id);
      if (row.supply_warehouse_id != null) {
        const wh = (
          await client.query("SELECT * FROM warehouses WHERE id=$1 FOR SHARE", [
            row.supply_warehouse_id,
          ])
        ).rows[0];
        if (!wh || !equal(wh.institute_id, actor.institute_id)) throw missing();
        if (wh.department_id != null) await department(wh.department_id);
      }
    }
    if (kind === "item") link(row.request_id, request?.id);
    if (kind === "award") {
      const item = await visit("item", row.request_item_id);
      link(item.request_id, row.request_id);
      await supplier(row.supplier_id);
    }
    if (kind === "purchaseOrder") {
      link(row.request_id, request?.id);
      await supplier(row.supplier_id);
      await children("poLine", "purchase_order_id", row.id);
      await children("receipt", "purchase_order_id", row.id);
      await children("invoice", "purchase_order_id", row.id);
      await children("commitment", "purchase_order_id", row.id);
      if (row.rfx_id != null) {
        const event = (
          await client.query("SELECT * FROM rfx_events WHERE id=$1 FOR SHARE", [
            row.rfx_id,
          ])
        ).rows[0];
        if (!event) throw missing();
        link(event.request_id, request.id);
      }
      if (row.rfx_response_id != null) {
        const response = (
          await client.query(
            "SELECT * FROM rfx_responses WHERE id=$1 FOR SHARE",
            [row.rfx_response_id],
          )
        ).rows[0];
        if (!response) throw missing();
        if (row.rfx_id != null) link(response.rfx_id, row.rfx_id);
        const parentEvent = (
          await client.query("SELECT * FROM rfx_events WHERE id=$1 FOR SHARE", [
            response.rfx_id,
          ])
        ).rows[0];
        if (!parentEvent) throw missing();
        link(parentEvent.request_id, row.request_id);
        link(response.supplier_id, row.supplier_id);
        if (response.request_id != null)
          link(response.request_id, row.request_id);
      }
    }
    if (kind === "poLine") {
      const po = await visit("purchaseOrder", row.purchase_order_id);
      const item = await visit("item", row.requested_item_id);
      link(item.request_id, po.request_id);
      await children("receiptLine", "purchase_order_item_id", row.id);
      await children("invoiceLine", "purchase_order_item_id", row.id);
      if (row.award_id != null) {
        const award = await visit("award", row.award_id);
        link(award.request_id, po.request_id);
        link(award.request_item_id, item.id);
        link(award.supplier_id, po.supplier_id);
      }
    }
    if (kind === "receipt") {
      const po = await visit("purchaseOrder", row.purchase_order_id);
      link(row.request_id, po.request_id);
      await children("receiptLine", "goods_receipt_id", row.id);
    }
    if (kind === "receiptLine") {
      const receipt = await visit("receipt", row.goods_receipt_id),
        line = await visit("poLine", row.purchase_order_item_id);
      link(line.purchase_order_id, receipt.purchase_order_id);
      link(row.requested_item_id, line.requested_item_id);
      if (row.warehouse_id != null) {
        const wh = (
          await client.query("SELECT * FROM warehouses WHERE id=$1 FOR SHARE", [
            row.warehouse_id,
          ])
        ).rows[0];
        if (!wh || !equal(wh.institute_id, actor.institute_id)) throw missing();
        if (wh.department_id != null) await department(wh.department_id);
      }
    }
    if (kind === "invoice") {
      const po = await visit("purchaseOrder", row.purchase_order_id);
      link(row.request_id, po.request_id);
      link(row.supplier_id, po.supplier_id);
      if (row.receipt_id != null) {
        const receipt = await visit("receipt", row.receipt_id);
        link(receipt.purchase_order_id, po.id);
      }
      await children("invoiceLine", "supplier_invoice_id", row.id);
      await children("match", "supplier_invoice_id", row.id);
      await children("voucher", "supplier_invoice_id", row.id);
      await children("payable", "supplier_invoice_id", row.id);
      await children("payment", "supplier_invoice_id", row.id);
    }
    if (kind === "invoiceLine") {
      const invoice = await visit("invoice", row.supplier_invoice_id),
        line = await visit("poLine", row.purchase_order_item_id);
      link(line.purchase_order_id, invoice.purchase_order_id);
      link(row.requested_item_id, line.requested_item_id);
    }
    if (kind === "match") {
      const invoice = await visit("invoice", row.supplier_invoice_id);
      link(row.request_id, invoice.request_id);
    }
    if (kind === "voucher") {
      const invoice = await visit("invoice", row.supplier_invoice_id);
      link(row.request_id, invoice.request_id);
      const lines = (
        await client.query(
          "SELECT * FROM ap_voucher_lines WHERE ap_voucher_id=$1 ORDER BY id FOR SHARE",
          [row.id],
        )
      ).rows;
      await accountingReferences(lines);
    }
    if (kind === "financePosting") {
      const voucher = await visit("voucher", row.ap_voucher_id),
        invoice = await visit("invoice", row.supplier_invoice_id);
      link(voucher.supplier_invoice_id, invoice.id);
      link(row.request_id, invoice.request_id);
    }
    if (kind === "payable") {
      const invoice = await visit("invoice", row.supplier_invoice_id),
        voucher = await visit("voucher", row.ap_voucher_id);
      link(row.request_id, invoice.request_id);
      link(row.supplier_id, invoice.supplier_id);
      link(voucher.supplier_invoice_id, invoice.id);
      const payments = (
        await client.query(
          "SELECT payment_record_id FROM payment_allocations WHERE ap_payable_id=$1 ORDER BY payment_record_id FOR SHARE",
          [row.id],
        )
      ).rows;
      for (const allocation of payments)
        await visit("payment", allocation.payment_record_id);
    }
    if (kind === "payment") {
      const invoice = await visit("invoice", row.supplier_invoice_id),
        voucher = await visit("voucher", row.ap_voucher_id);
      link(row.request_id, invoice.request_id);
      link(voucher.supplier_invoice_id, invoice.id);
      const allocations = (
        await client.query(
          "SELECT * FROM payment_allocations WHERE payment_record_id=$1 ORDER BY id FOR SHARE",
          [row.id],
        )
      ).rows;
      if (!allocations.length) throw missing();
      for (const allocation of allocations) {
        const payable = await visit("payable", allocation.ap_payable_id);
        link(payable.request_id, row.request_id);
        link(payable.supplier_invoice_id, row.supplier_invoice_id);
        link(payable.ap_voucher_id, row.ap_voucher_id);
      }
    }
    if (kind === "budget") {
      await department(row.department_id);
      await project(row.project_id);
      // A department budget is shared by legitimate local requests. Validate
      // aggregate contributors against their own root, not the current request.
      const invalid = (
        await client.query(
          `SELECT cl.id FROM commitment_ledger cl
        LEFT JOIN requests budget_r ON budget_r.id=cl.request_id
        LEFT JOIN purchase_orders budget_po ON budget_po.id=cl.purchase_order_id
        WHERE cl.budget_envelope_id=$1 AND (budget_r.id IS NULL OR budget_r.institute_id IS DISTINCT FROM $2
          OR budget_r.department_id IS DISTINCT FROM $3 OR budget_r.project_id IS DISTINCT FROM $4::uuid
          OR (cl.purchase_order_id IS NOT NULL AND (budget_po.id IS NULL OR budget_po.request_id IS DISTINCT FROM cl.request_id))) LIMIT 1`,
          [
            row.id,
            actor.institute_id,
            row.department_id,
            row.project_id || null,
          ],
        )
      ).rows;
      if (invalid.length) throw missing();
      if (request) {
        link(row.department_id, request.department_id);
        if (String(row.project_id || "") !== String(request.project_id || ""))
          throw missing();
      }
    }
    if (kind === "commitment") {
      const budget = await visit("budget", row.budget_envelope_id);
      link(row.request_id, request?.id);
      if (row.purchase_order_id != null) {
        const po = await visit("purchaseOrder", row.purchase_order_id);
        link(po.request_id, row.request_id);
        if (
          String(po.currency).toUpperCase() !==
          String(budget.currency).toUpperCase()
        )
          throw missing();
      }
      if (row.supplier_invoice_id != null)
        await visit("invoice", row.supplier_invoice_id);
      if (row.ap_voucher_id != null) await visit("voucher", row.ap_voucher_id);
    }
    return row;
  }
  async function accountingReferences(lines) {
    const types = {
      REQUEST: "request",
      PURCHASE_ORDER: "purchaseOrder",
      PO: "purchaseOrder",
      AP_INVOICE: "invoice",
      SUPPLIER_INVOICE: "invoice",
      INVOICE: "invoice",
      AP_VOUCHER: "voucher",
      ACCOUNTS_PAYABLE: "payable",
    };
    for (const line of lines || []) {
      if (line.reference_id != null) {
        const kind = types[String(line.reference_type || "").toUpperCase()];
        if (!kind) throw missing();
        await visit(kind, id(line.reference_id));
      }
      if (line.cost_center_id != null || line.costCenterId != null) {
        const cc = (
          await client.query(
            "SELECT * FROM finance_cost_centers WHERE id=$1 FOR SHARE",
            [line.cost_center_id ?? line.costCenterId],
          )
        ).rows[0];
        if (!cc || !cc.department_id) throw missing();
        await department(cc.department_id);
        if (request) link(cc.department_id, request.department_id);
        await project(cc.project_id);
      }
    }
  }
  if (request) await visit("request", request.id);
  for (const root of roots) await visit(root.kind, root.id);
  if (refs.wholeRequest && request) {
    for (const kind of [
      "purchaseOrder",
      "receipt",
      "invoice",
      "match",
      "voucher",
      "financePosting",
      "payable",
      "payment",
      "commitment",
    ])
      await children(kind, "request_id", request.id);
  }
  for (const value of refs.poLineIds || []) await visit("poLine", id(value));
  for (const value of refs.warehouseIds || []) {
    const wh = (
      await client.query("SELECT * FROM warehouses WHERE id=$1 FOR SHARE", [
        id(value),
      ])
    ).rows[0];
    if (!wh || !equal(wh.institute_id, actor.institute_id)) throw missing();
    if (wh.department_id != null) await department(wh.department_id);
  }
  await accountingReferences(refs.accountingLines);
  if (!request && !roots.some((r) => r.kind === "budget") && !refs.departmentId)
    throw missing();
  if (refs.departmentId) {
    await department(refs.departmentId);
    await project(refs.projectId);
  }
  if (refs.rfxId != null || refs.rfxResponseId != null) {
    if (!request) throw missing();
    let eventId = refs.rfxId == null ? null : id(refs.rfxId);
    if (refs.rfxResponseId != null) {
      const response = (
        await client.query(
          "SELECT * FROM rfx_responses WHERE id=$1 FOR SHARE",
          [id(refs.rfxResponseId)],
        )
      ).rows[0];
      if (!response) throw missing();
      if (response.request_id != null) link(response.request_id, request.id);
      for (const awardId of refs.awardIds || [])
        link(
          response.supplier_id,
          seen.get(`award:${id(awardId)}`)?.supplier_id,
        );
      if (eventId != null) link(response.rfx_id, eventId);
      eventId = response.rfx_id;
    }
    const event = (
      await client.query("SELECT * FROM rfx_events WHERE id=$1 FOR SHARE", [
        id(eventId),
      ])
    ).rows[0];
    if (!event) throw missing();
    link(event.request_id, request.id);
  }
  // When a command names both a document and its parent, authorize the exact
  // relationship as well as each object's institute (including retry records).
  for (const [childKey, childKind, column, parentKey, parentKind] of [
    [
      "receiptId",
      "receipt",
      "purchase_order_id",
      "purchaseOrderId",
      "purchaseOrder",
    ],
    [
      "invoiceId",
      "invoice",
      "purchase_order_id",
      "purchaseOrderId",
      "purchaseOrder",
    ],
    ["voucherId", "voucher", "supplier_invoice_id", "invoiceId", "invoice"],
    [
      "financePostingId",
      "financePosting",
      "ap_voucher_id",
      "voucherId",
      "voucher",
    ],
    [
      "commitmentId",
      "commitment",
      "purchase_order_id",
      "purchaseOrderId",
      "purchaseOrder",
    ],
    ["matchResultId", "match", "supplier_invoice_id", "invoiceId", "invoice"],
  ])
    if (refs[childKey] != null && refs[parentKey] != null) {
      link(
        seen.get(`${childKind}:${id(refs[childKey])}`)?.[column],
        seen.get(`${parentKind}:${id(refs[parentKey])}`)?.id,
      );
    }
  if (refs.paymentId != null && refs.payableId != null) {
    const payment = seen.get(`payment:${id(refs.paymentId)}`),
      payable = seen.get(`payable:${id(refs.payableId)}`);
    link(payment.supplier_invoice_id, payable.supplier_invoice_id);
    link(payment.ap_voucher_id, payable.ap_voucher_id);
    if (
      !(
        await client.query(
          "SELECT id FROM payment_allocations WHERE payment_record_id=$1 AND ap_payable_id=$2 LIMIT 1",
          [refs.paymentId, refs.payableId],
        )
      ).rows.length
    )
      throw missing();
  }
  const context = {
    actor,
    instituteId: actor.institute_id,
    request,
    documents: seen,
  };
  tx.financialContext = context;
  return context;
}
module.exports = { authorizeCommand, loadActor, fail, missing, id, TABLES };
