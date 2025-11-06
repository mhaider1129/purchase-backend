const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const canManageContractEvaluations = req => {
  const role = (req.user?.role || '').toUpperCase();
  return role === 'SCM' || role === 'COO' || role === 'ADMIN';
};

const parseJsonValue = value => {
  if (value === null || value === undefined) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return parseJsonValue(value.toString('utf8'));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (err) {
      console.error('❌ Failed to parse JSON value:', err.message);
      return null;
    }
  }

  if (typeof value === 'object') {
    return value;
  }

  return null;
};

const normalizeComponentEntry = entry => {
  if (!entry && entry !== 0) {
    return null;
  }

  if (typeof entry === 'string') {
    const name = entry.trim();
    if (!name) {
      return null;
    }
    return { name, score: null };
  }

  if (typeof entry === 'object') {
    const name = (entry.name || entry.component || entry.label || '').trim();
    if (!name) {
      return null;
    }

    const rawScore = entry.score ?? entry.value ?? null;
    if (rawScore === null || rawScore === undefined || rawScore === '') {
      return { name, score: null };
    }

    const numericScore = Number(rawScore);
    if (!Number.isFinite(numericScore)) {
      return { name, score: null };
    }

    return { name, score: numericScore };
  }

  try {
    const fallbackName = String(entry).trim();
    if (!fallbackName) {
      return null;
    }
    return { name: fallbackName, score: null };
  } catch (err) {
    return null;
  }
};

const computeOverallScore = components => {
  const numericScores = components
    .map(component => (Number.isFinite(component.score) ? component.score : null))
    .filter(score => score !== null);

  if (numericScores.length === 0) {
    return null;
  }

  const average = numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length;
  return Number(average.toFixed(2));
};

const normalizeEvaluationCriteriaStructure = (input, criterionMeta = {}) => {
  if (!input && criterionMeta && Array.isArray(criterionMeta.components)) {
    input = { components: criterionMeta.components };
  }

  if (Array.isArray(input)) {
    input = { components: input };
  }

  const base = typeof input === 'object' && input !== null ? { ...input } : {};

  const componentsSource =
    base.components || base.criteria || base.items || criterionMeta.components || [];

  const normalizedComponents = Array.isArray(componentsSource)
    ? componentsSource
        .map(normalizeComponentEntry)
        .filter(component => component && component.name)
    : [];

  const criterionId = base.criterionId || base.criterion_id || criterionMeta.id || null;
  const criterionName =
    base.criterionName ||
    base.name ||
    base.criterion_name ||
    criterionMeta.name ||
    null;
  const criterionRole =
    base.criterionRole ||
    base.role ||
    base.criterion_role ||
    criterionMeta.role ||
    null;

  let overallScore = base.overallScore;
  if (overallScore !== null && overallScore !== undefined) {
    const numeric = Number(overallScore);
    overallScore = Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
  }

  if (overallScore === null || overallScore === undefined) {
    overallScore = computeOverallScore(normalizedComponents);
  }

  return {
    ...base,
    criterionId,
    criterionName,
    criterionRole,
    components: normalizedComponents,
    overallScore: overallScore === undefined ? null : overallScore,
  };
};

const serializeEvaluationRow = row => {
  const evaluationCriteria = normalizeEvaluationCriteriaStructure(
    parseJsonValue(row.evaluation_criteria),
    {
      id: row.criterion_id,
      name: row.criterion_name,
      role: row.criterion_role,
    }
  );

  return {
    ...row,
    evaluation_criteria: evaluationCriteria,
  };
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
            criterion_id INTEGER REFERENCES evaluation_criteria(id) ON DELETE SET NULL,
            criterion_name TEXT,
            criterion_role TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          ALTER TABLE contract_evaluations
            ADD COLUMN IF NOT EXISTS criterion_id INTEGER REFERENCES evaluation_criteria(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS criterion_name TEXT,
            ADD COLUMN IF NOT EXISTS criterion_role TEXT
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

  const { contract_id, evaluator_id, evaluation_criteria, criterion_id } = req.body;

  if (!contract_id || !evaluator_id) {
    return next(createHttpError(400, 'contract_id and evaluator_id are required'));
  }

  try {
    await ensureContractEvaluationsTable();
    let criterionMeta = { id: null, name: null, role: null, components: [] };

    if (criterion_id) {
      const { rows: criterionRows } = await pool.query(
        'SELECT id, name, role, components FROM evaluation_criteria WHERE id = $1',
        [criterion_id]
      );

      if (criterionRows.length === 0) {
        return next(createHttpError(404, 'Selected evaluation criterion not found'));
      }

      const criterion = criterionRows[0];
      criterionMeta = {
        id: criterion.id,
        name: criterion.name,
        role: criterion.role,
        components: parseJsonValue(criterion.components) || [],
      };
    }

    let normalizedCriteria = null;
    if (evaluation_criteria !== undefined) {
      const parsed = parseJsonValue(evaluation_criteria);
      normalizedCriteria = normalizeEvaluationCriteriaStructure(parsed, criterionMeta);
    } else {
      normalizedCriteria = normalizeEvaluationCriteriaStructure(null, criterionMeta);
    }

    const { rows } = await pool.query(
      `INSERT INTO contract_evaluations (contract_id, evaluator_id, evaluation_criteria, criterion_id, criterion_name, criterion_role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        contract_id,
        evaluator_id,
        normalizedCriteria,
        normalizedCriteria.criterionId,
        normalizedCriteria.criterionName,
        normalizedCriteria.criterionRole,
      ]
    );
    res.status(201).json(serializeEvaluationRow(rows[0]));
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
      `SELECT ce.*, u.name as evaluator_name
         FROM contract_evaluations ce
         JOIN users u ON ce.evaluator_id = u.id
        WHERE ce.contract_id = $1
        ORDER BY ce.created_at ASC`,
      [contract_id]
    );
    res.json(rows.map(serializeEvaluationRow));
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
    const { rows: existingRows } = await pool.query(
      `SELECT evaluator_id, criterion_id, criterion_name, criterion_role, evaluation_criteria
         FROM contract_evaluations
        WHERE id = $1`,
      [id]
    );

    if (existingRows.length === 0) {
      return next(createHttpError(404, 'Evaluation not found'));
    }

    const existing = existingRows[0];

    if (existing.evaluator_id !== req.user.id && !canManageContractEvaluations(req)) {
      return next(createHttpError(403, 'You are not authorized to update this evaluation'));
    }

    let normalizedCriteria = normalizeEvaluationCriteriaStructure(
      parseJsonValue(evaluation_criteria),
      {
        id: existing.criterion_id,
        name: existing.criterion_name,
        role: existing.criterion_role,
        components: normalizeEvaluationCriteriaStructure(
          parseJsonValue(existing.evaluation_criteria),
          {
            id: existing.criterion_id,
            name: existing.criterion_name,
            role: existing.criterion_role,
          }
        ).components,
      }
    );

    const { rows } = await pool.query(
      `UPDATE contract_evaluations
       SET status = $1, evaluation_notes = $2, evaluation_criteria = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, evaluation_notes, normalizedCriteria, id]
    );
    res.json(serializeEvaluationRow(rows[0]));
  } catch (err) {
    console.error('❌ Failed to update contract evaluation:', err);
    next(createHttpError(500, 'Failed to update contract evaluation'));
  }
};

const getMyEvaluations = async (req, res, next) => {
  try {
    await ensureContractEvaluationsTable();
    const { rows } = await pool.query(
      `SELECT ce.*, c.title as contract_title
         FROM contract_evaluations ce
         JOIN contracts c ON ce.contract_id = c.id
        WHERE ce.evaluator_id = $1
        ORDER BY ce.created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(serializeEvaluationRow));
  } catch (err) {
    console.error('❌ Failed to get my evaluations:', err);
    next(createHttpError(500, 'Failed to get my evaluations'));
  }
};

const getContractEvaluationById = async (req, res, next) => {
  const { id } = req.params;

  try {
    await ensureContractEvaluationsTable();
    const { rows } = await pool.query(
      `SELECT ce.*, c.title AS contract_title, u.name AS evaluator_name
         FROM contract_evaluations ce
         JOIN contracts c ON ce.contract_id = c.id
         JOIN users u ON ce.evaluator_id = u.id
        WHERE ce.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Evaluation not found'));
    }

    const evaluation = serializeEvaluationRow(rows[0]);

    if (
      evaluation.evaluator_id !== req.user.id &&
      !canManageContractEvaluations(req)
    ) {
      return next(createHttpError(403, 'You are not authorized to view this evaluation'));
    }

    res.json(evaluation);
  } catch (err) {
    console.error('❌ Failed to get contract evaluation by id:', err);
    next(createHttpError(500, 'Failed to get contract evaluation'));
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
  getContractEvaluationById,
  getEvaluationCriteria,
};