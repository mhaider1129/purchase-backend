const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureFinanceCoreTables = require('../utils/ensureFinanceCoreTables');

const requireBudgetAccess = (req) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (!['scm', 'admin', 'finance', 'financeapprover', 'cfo'].includes(role)) {
    throw createHttpError(403, 'You are not authorized to access budget control');
  }
};

const listDepartmentBudgets = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requireBudgetAccess(req);
    await ensureFinanceCoreTables(client);
    const fiscalYear = Number(req.query?.fiscal_year) || new Date().getUTCFullYear();

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
       WHERE be.fiscal_year = $1
       GROUP BY be.id, d.name, p.name
       ORDER BY d.name ASC, p.name ASC NULLS FIRST`,
      [fiscalYear],
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
    res.json({ data });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
};

const upsertDepartmentBudget = async (req, res, next) => {
  const client = await pool.connect();
  try {
    requireBudgetAccess(req);
    await ensureFinanceCoreTables(client);
    const {
      department_id,
      project_id = null,
      fiscal_year,
      currency = 'USD',
      allocated_amount,
    } = req.body || {};

    if (!department_id || !fiscal_year || Number(allocated_amount) < 0) {
      throw createHttpError(400, 'department_id, fiscal_year and non-negative allocated_amount are required');
    }

    const result = await client.query(
      `INSERT INTO budget_envelopes (
        department_id, project_id, fiscal_year, currency, allocated_amount, consumed_amount, created_by
      ) VALUES ($1,$2,$3,$4,$5,0,$6)
      ON CONFLICT (department_id, project_id, fiscal_year, currency)
      DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount,
                    updated_at = NOW()
      RETURNING *`,
      [department_id, project_id, fiscal_year, currency, Number(allocated_amount), req.user.id],
    );
    res.status(201).json({ message: 'Budget envelope saved', data: result.rows[0] });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
};

module.exports = { listDepartmentBudgets, upsertDepartmentBudget };