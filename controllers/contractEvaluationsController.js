const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const canManageContractEvaluations = (req) => {
  const role = (req.user?.role || '').toUpperCase();
  return role === 'SCM' || role === 'COO' || role === 'ADMIN';
};

const ensureContractEvaluationsTable = (() => {
  let initialized = false;
  let initializingPromise = null;

  return async () => {
    if (initialized) {
      return;
    }

    if (initializingPromise) {
      await initializingPromise;
      return;
    }

    initializingPromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_evaluations (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            evaluator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            evaluation_notes TEXT,
            evaluation_criteria JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        initialized = true;
      } catch (err) {
        console.error('❌ Failed to ensure contract_evaluations table exists:', err);
        throw err;
      } finally {
        initializingPromise = null;
      }
    })();

    await initializingPromise;
  };
})();

const createContractEvaluation = async (req, res, next) => {
  if (!canManageContractEvaluations(req)) {
    return next(createHttpError(403, 'You are not authorized to create contract evaluations'));
  }

  const { contract_id, evaluator_id, evaluation_criteria } = req.body;

  if (!contract_id || !evaluator_id) {
    return next(createHttpError(400, 'contract_id and evaluator_id are required'));
  }

  try {
    await ensureContractEvaluationsTable();
    const { rows } = await pool.query(
      `INSERT INTO contract_evaluations (contract_id, evaluator_id, evaluation_criteria)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [contract_id, evaluator_id, evaluation_criteria]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create contract evaluation:', err);
    next(createHttpError(500, 'Failed to create contract evaluation'));
  }
};

const getContractEvaluations = async (req, res, next) => {
  const { contract_id } = req.query;

  if (!contract_id) {
    return next(createHttpError(400, 'contract_id is required'));
  }

  try {
    await ensureContractEvaluationsTable();
    const { rows } = await pool.query(
      'SELECT ce.*, u.name as evaluator_name FROM contract_evaluations ce JOIN users u ON ce.evaluator_id = u.id WHERE ce.contract_id = $1',
      [contract_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to get contract evaluations:', err);
    next(createHttpError(500, 'Failed to get contract evaluations'));
  }
};

const updateContractEvaluation = async (req, res, next) => {
  const { id } = req.params;
  const { status, evaluation_notes, evaluation_criteria } = req.body;

  try {
    await ensureContractEvaluationsTable();
    const { rows: existingRows } = await pool.query('SELECT evaluator_id FROM contract_evaluations WHERE id = $1', [id]);

    if (existingRows.length === 0) {
      return next(createHttpError(404, 'Evaluation not found'));
    }

    if (existingRows[0].evaluator_id !== req.user.id) {
      return next(createHttpError(403, 'You are not authorized to update this evaluation'));
    }

    const { rows } = await pool.query(
      `UPDATE contract_evaluations
       SET status = $1, evaluation_notes = $2, evaluation_criteria = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, evaluation_notes, evaluation_criteria, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update contract evaluation:', err);
    next(createHttpError(500, 'Failed to update contract evaluation'));
  }
};

const getMyEvaluations = async (req, res, next) => {
  try {
    await ensureContractEvaluationsTable();
    const { rows } = await pool.query(
      'SELECT ce.*, c.title as contract_title FROM contract_evaluations ce JOIN contracts c ON ce.contract_id = c.id WHERE ce.evaluator_id = $1',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to get my evaluations:', err);
    next(createHttpError(500, 'Failed to get my evaluations'));
  }
};

const getEvaluationCriteria = async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM evaluation_criteria');
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to get evaluation criteria:', err);
    next(createHttpError(500, 'Failed to get evaluation criteria'));
  }
};

module.exports = {
  ensureContractEvaluationsTable,
  createContractEvaluation,
  getContractEvaluations,
  updateContractEvaluation,
  getMyEvaluations,
  getEvaluationCriteria,
};