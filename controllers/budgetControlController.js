const pool = require("../config/db");
const createHttpError = require("../utils/httpError");

const { withRead, predicate } = require("../services/p2pReadScope");
const { authorizeCommand, fail, id } = require("../services/p2pAuthorization");
const withTransaction = require("../utils/withTransaction");
const { writeAuditEvent } = require("../services/auditService");

const listDepartmentBudgets = async (req, res, next) => {
  try {
    const payload = await withRead(req.user, async (client, actor) => {
      const fiscalYear =
        Number(req.query?.fiscal_year) || new Date().getUTCFullYear();

      const { rows } = await client.query(
        `SELECT
         be.id,
         be.department_id,
         d.name AS department_name,
         be.project_id,
         p.name AS project_name,
         be.fiscal_year,
         be.currency,
         be.allocated_amount,
         be.consumed_amount,
         COALESCE(SUM(CASE WHEN cl.stage = 'reservation' THEN cl.amount ELSE 0 END), 0) AS reserved,
         COALESCE(SUM(CASE WHEN cl.stage = 'encumbrance' THEN cl.amount ELSE 0 END), 0) AS encumbered,
         COALESCE(SUM(CASE WHEN cl.stage = 'actual' THEN cl.amount ELSE 0 END), 0) AS actual
       FROM budget_envelopes be
       JOIN departments d ON d.id = be.department_id
       LEFT JOIN projects p ON p.id = be.project_id
       LEFT JOIN commitment_ledger cl ON cl.budget_envelope_id = be.id
       WHERE be.fiscal_year = $1 AND ${predicate("budget", "be", "$2")}
         AND NOT EXISTS(SELECT 1 FROM commitment_ledger bad_cl WHERE bad_cl.budget_envelope_id=be.id AND NOT ${predicate("commitment", "bad_cl", "$2")})
       GROUP BY be.id, d.name, p.name
       ORDER BY d.name ASC, p.name ASC NULLS FIRST`,
        [fiscalYear, actor.institute_id],
      );

      const data = rows.map((row) => {
        const allocated = Number(row.allocated_amount) || 0;
        const reserved = Number(row.reserved) || 0;
        const encumbered = Number(row.encumbered) || 0;
        const actual = Number(row.actual) || 0;
        return {
          ...row,
          allocated_amount: allocated,
          reserved,
          encumbered,
          actual,
          available_actual_only: allocated - actual,
          available_strict: allocated - (reserved + encumbered + actual),
        };
      });
      const departments = (
        await client.query(
          "SELECT id,name FROM departments WHERE institute_id=$1 ORDER BY name",
          [actor.institute_id],
        )
      ).rows;
      return {
        data,
        departments,
        can_manage_budget:
          require("../utils/permissionService").userHasPermission(
            actor,
            "finance.budget.manage",
          ),
      };
    });
    res.set("Cache-Control", "private, no-store").json(payload);
  } catch (error) {
    next(error);
  }
};

const upsertDepartmentBudget = async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const {
        department_id,
        project_id = null,
        fiscal_year,
        currency = "USD",
        allocated_amount,
      } = req.body || {};
      const year = Number(fiscal_year),
        amount = String(allocated_amount ?? "").trim(),
        code = String(currency).trim().toUpperCase();
      if (
        !Number.isInteger(year) ||
        year < 1900 ||
        year > 9999 ||
        !/^\d+(?:\.\d+)?$/.test(amount) ||
        !/^[A-Z]{3}$/.test(code)
      )
        throw fail(
          400,
          "Valid department, fiscal year, currency and non-negative decimal amount are required",
        );
      const departmentId = id(department_id);
      const projectId =
        project_id == null ? null : String(project_id).trim().toLowerCase();
      const { actor, instituteId } = await authorizeCommand(
        { client },
        req.user,
        "finance.budget.manage",
        { departmentId, projectId },
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`budget-envelope:${departmentId}:${projectId || ""}:${year}:${code}`],
      );
      const rows = (
        await client.query(
          "SELECT * FROM budget_envelopes WHERE department_id=$1 AND project_id IS NOT DISTINCT FROM $2::uuid AND fiscal_year=$3 AND currency=$4 ORDER BY id FOR UPDATE",
          [departmentId, projectId, year, code],
        )
      ).rows;
      if (rows.length > 1)
        throw fail(
          409,
          "Budget configuration requires reconciliation",
          "BUDGET_SCOPE_AMBIGUOUS",
        );
      const before = rows[0] || null;
      const after = before
        ? (
            await client.query(
              "UPDATE budget_envelopes SET allocated_amount=$2,updated_at=NOW() WHERE id=$1 RETURNING *",
              [before.id, amount],
            )
          ).rows[0]
        : (
            await client.query(
              "INSERT INTO budget_envelopes(department_id,project_id,fiscal_year,currency,allocated_amount,consumed_amount,created_by) VALUES($1,$2,$3,$4,$5,0,$6) RETURNING *",
              [departmentId, projectId, year, code, amount, actor.id],
            )
          ).rows[0];
      await writeAuditEvent({
        client,
        entityType: "budget_envelope",
        entityId: after.id,
        action: before ? "BUDGET_ENVELOPE_UPDATED" : "BUDGET_ENVELOPE_CREATED",
        actorUserId: actor.id,
        instituteId,
        beforeData: before,
        afterData: after,
      });
      return after;
    });
    res.status(201).json({ message: "Budget envelope saved", data: result });
  } catch (error) {
    next(error);
  }
};
module.exports = { listDepartmentBudgets, upsertDepartmentBudget };
