"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const defaultPool = require("../config/db");
const finance = require("./p2pAuthorization");
const sourcing = require("./rfxAuthorization");
const audit = require("./auditService");
const equal = (a, b) => a != null && b != null && String(a) === String(b);
const missing = () =>
  finance.fail(
    404,
    "Procurement evaluation or reference not found",
    "EVALUATION_NOT_FOUND",
  );
const children = {
  offer_id: "procurement_evaluation_offers",
  test_id: "procurement_evaluation_tests",
  criteria_id: "procurement_evaluation_criteria",
  selected_offer_id: "procurement_evaluation_offers",
};
function predicate(a = "c", parameter = "$1") {
  const root = `EXISTS(SELECT 1 FROM departments eval_d WHERE eval_d.id=COALESCE(${a}.department_id,(SELECT department_id FROM requests WHERE id=${a}.request_id)) AND eval_d.institute_id=${parameter}) AND (${a}.request_id IS NULL OR EXISTS(SELECT 1 FROM requests eval_r WHERE eval_r.id=${a}.request_id AND eval_r.institute_id=${parameter} AND (${a}.department_id IS NULL OR eval_r.department_id=${a}.department_id))) AND (${a}.section_id IS NULL OR EXISTS(SELECT 1 FROM sections eval_s WHERE eval_s.id=${a}.section_id AND eval_s.department_id=COALESCE(${a}.department_id,(SELECT department_id FROM requests WHERE id=${a}.request_id))))`;
  const offers = `NOT EXISTS(SELECT 1 FROM procurement_evaluation_offers eval_o LEFT JOIN suppliers eval_s ON eval_s.id=eval_o.supplier_id WHERE eval_o.evaluation_case_id=${a}.id AND eval_o.supplier_id IS NOT NULL AND (eval_s.id IS NULL OR (eval_s.institute_id IS NOT NULL AND eval_s.institute_id IS DISTINCT FROM ${parameter}))) AND (${a}.selected_offer_id IS NULL OR EXISTS(SELECT 1 FROM procurement_evaluation_offers eval_selected WHERE eval_selected.id=${a}.selected_offer_id AND eval_selected.evaluation_case_id=${a}.id))`;
  const paired = (table, rightTable, rightColumn) =>
    `NOT EXISTS(SELECT 1 FROM ${table} eval_link LEFT JOIN procurement_evaluation_offers eval_left ON eval_left.id=eval_link.offer_id LEFT JOIN ${rightTable} eval_right ON eval_right.id=eval_link.${rightColumn} WHERE (eval_link.evaluation_case_id=${a}.id OR eval_left.evaluation_case_id=${a}.id OR eval_right.evaluation_case_id=${a}.id) AND (eval_left.evaluation_case_id IS DISTINCT FROM eval_link.evaluation_case_id OR eval_right.evaluation_case_id IS DISTINCT FROM eval_link.evaluation_case_id))`;
  const results = `NOT EXISTS(SELECT 1 FROM procurement_evaluation_results eval_result LEFT JOIN procurement_evaluation_offers eval_result_offer ON eval_result_offer.id=eval_result.offer_id WHERE (eval_result.evaluation_case_id=${a}.id OR eval_result_offer.evaluation_case_id=${a}.id) AND eval_result_offer.evaluation_case_id IS DISTINCT FROM eval_result.evaluation_case_id)`;
  return `${root} AND ${offers} AND ${paired("procurement_evaluation_offer_test_costs", "procurement_evaluation_tests", "test_id")} AND ${paired("procurement_evaluation_scores", "procurement_evaluation_criteria", "criteria_id")} AND ${results}`;
}
async function authorize(
  client,
  input,
  { caseId, requestId, departmentId, sectionId, body = {} } = {},
) {
  const actor = await finance.loadActor(client, input, "evaluations.manage");
  if (caseId == null && requestId == null && departmentId == null)
    departmentId = actor.department_id;
  let evaluation;
  if (caseId != null) {
    evaluation = (
      await client.query(
        "SELECT * FROM procurement_evaluation_cases WHERE id=$1",
        [finance.id(caseId)],
      )
    ).rows[0];
    if (!evaluation) throw missing();
    requestId = evaluation.request_id;
    departmentId = evaluation.department_id;
    sectionId = evaluation.section_id;
  }
  // A department is the existing independent-evaluation root; request-bound cases
  // must match the actual request department. No owner is inferred from creators.
  const ctx = await finance.authorizeCommand(
    { client },
    actor,
    "evaluations.manage",
    requestId != null ? { requestId } : { departmentId },
  );
  if (ctx.request) {
    if (departmentId != null && !equal(departmentId, ctx.request.department_id))
      throw missing();
    departmentId = ctx.request.department_id;
  }
  if (departmentId == null) throw missing();
  if (sectionId != null) {
    const section = (
      await client.query(
        "SELECT id,department_id FROM sections WHERE id=$1 FOR SHARE",
        [finance.id(sectionId)],
      )
    ).rows[0];
    if (!section || !equal(section.department_id, departmentId))
      throw missing();
  }
  if (evaluation) {
    const current = (
      await client.query(
        "SELECT * FROM procurement_evaluation_cases WHERE id=$1 FOR UPDATE",
        [evaluation.id],
      )
    ).rows[0];
    for (const key of ["request_id", "department_id", "section_id"]) {
      if (String(current?.[key] ?? "") !== String(evaluation[key] ?? ""))
        throw missing();
      if (
        Object.hasOwn(body, key) &&
        String(body[key] ?? "") !== String(evaluation[key] ?? "")
      )
        throw finance.fail(
          409,
          "Evaluation source ownership cannot be changed; create a case against the correct source",
          "EVALUATION_SOURCE_IMMUTABLE",
        );
    }
    evaluation = current;
    if (
      !(
        await client.query(
          `SELECT c.id FROM procurement_evaluation_cases c WHERE c.id=$1 AND ${predicate("c", "$2")}`,
          [evaluation.id, ctx.instituteId],
        )
      ).rowCount
    )
      throw missing();
    const check = async (table, value) => {
      const row = (
        await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR SHARE`, [
          finance.id(value),
        ])
      ).rows[0];
      if (!row || !equal(row.evaluation_case_id, evaluation.id))
        throw missing();
      return row;
    };
    for (const row of (
      await client.query(
        "SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id=$1 ORDER BY id FOR SHARE",
        [evaluation.id],
      )
    ).rows)
      if (row.supplier_id != null)
        await sourcing.assertSupplier(client, row.supplier_id, ctx.instituteId);
    if (evaluation.selected_offer_id != null)
      await check(children.selected_offer_id, evaluation.selected_offer_id);
    for (const [table, refs] of [
      ["procurement_evaluation_offer_test_costs", ["offer_id", "test_id"]],
      ["procurement_evaluation_scores", ["offer_id", "criteria_id"]],
      ["procurement_evaluation_results", ["offer_id"]],
    ]) {
      const rows = (
        await client.query(
          `SELECT * FROM ${table} WHERE evaluation_case_id=$1 ORDER BY id FOR SHARE`,
          [evaluation.id],
        )
      ).rows;
      for (const row of rows)
        for (const key of refs) await check(children[key], row[key]);
    }
    const visit = async (value) => {
      if (!value || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value)) {
        if (v != null && v !== "" && children[key])
          await check(children[key], v);
        if (key === "supplier_id" && v != null && v !== "")
          await sourcing.assertSupplier(client, v, ctx.instituteId);
        if (v && typeof v === "object") await visit(v);
      }
    };
    await visit(body);
  }
  return { ...ctx, case: evaluation, departmentId, sectionId, requestId };
}
function createContext(database = defaultPool) {
  const storage = new AsyncLocalStorage();
  const current = () => {
    const value = storage.getStore();
    if (!value)
      throw finance.fail(503, "Authorized evaluation transaction required");
    return value;
  };
  // All existing route helpers and calculations use this request-local client.
  // There is deliberately no fallback to the global pool outside the boundary.
  const db = { query: (...args) => current().client.query(...args) };
  const withRequest = async (req, res, work) => {
    const client = await database.connect();
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
    });
    try {
      await client.query("BEGIN");
      const actor = await finance.loadActor(
        client,
        req.user,
        "evaluations.manage",
      );
      const isCreate = req.method === "POST" && req.route.path === "/";
      let ctx;
      if (req.params.id != null || isCreate) {
        ctx = await authorize(client, actor, {
          caseId: req.params.id,
          requestId: req.body?.request_id,
          departmentId: req.body?.department_id,
          sectionId: req.body?.section_id,
          body: {
            ...req.body,
            ...Object.fromEntries(
              Object.entries({
                offer_id: req.params.offerId,
                test_id: req.params.testId,
                criteria_id: req.params.criteriaId,
              }).filter(([, v]) => v != null),
            ),
          },
        });
        if (isCreate) {
          req.body = { ...req.body, department_id: ctx.departmentId };
          if (req.body.status === "Finalized")
            throw finance.fail(
              400,
              "Use the existing finalize action after evaluation checks",
            );
        }
        if (
          req.method === "PATCH" &&
          req.route.path === "/:id" &&
          req.body?.status === "Finalized"
        )
          throw finance.fail(
            400,
            "Use the existing finalize action after evaluation checks",
          );
      } else ctx = { actor, instituteId: actor.institute_id };
      req.user = actor;
      await storage.run({ client, ctx }, () => work(req, deferred));
      // Existing report helpers can calculate/persist missing results. Their
      // evidence must share this transaction, even when invoked through GET.
      if (
        ctx.case &&
        req.method === "GET" &&
        [
          "/:id/recommendation",
          "/:id/optimization",
          "/:id/risk-adjusted-tco",
          "/:id/report-summary",
        ].includes(req.route.path)
      ) {
        await audit.writeAuditEvent({
          client,
          entityType: "procurement_evaluation",
          entityId: ctx.case.id,
          action: "procurement_evaluation.report_generated",
          actorUserId: ctx.actor.id,
          instituteId: ctx.instituteId,
          requestId: ctx.requestId,
          metadata: { route: req.route.path },
        });
      }
      await client.query("COMMIT");
      if (output) res[output.key](...output.args);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const record = async (action, actorId, targetId, details) => {
    const { client, ctx } = current();
    return audit.writeAuditEvent({
      client,
      entityType: "procurement_evaluation",
      entityId: targetId,
      action,
      actorUserId: ctx.actor.id,
      instituteId: ctx.instituteId,
      requestId: ctx.requestId,
      beforeData: ctx.case || null,
      afterData: details,
    });
  };
  return { db, current, withRequest, record };
}
module.exports = { createContext, authorize, predicate };
