const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const canManageSupplierEvaluations = (req) =>
  Boolean(req.user?.hasPermission && req.user.hasPermission('evaluations.manage'));

const ensureSupplierEvaluationsTable = (() => {
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
          CREATE TABLE IF NOT EXISTS supplier_evaluations (
            id SERIAL PRIMARY KEY,
            supplier_name TEXT NOT NULL,
            evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
            quality_score NUMERIC(5, 2),
            delivery_score NUMERIC(5, 2),
            cost_score NUMERIC(5, 2),
            compliance_score NUMERIC(5, 2),
            overall_score NUMERIC(5, 2) NOT NULL,
            strengths TEXT,
            weaknesses TEXT,
            action_items TEXT,
            evaluator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            evaluator_name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE INDEX IF NOT EXISTS supplier_evaluations_supplier_name_idx
            ON supplier_evaluations (LOWER(supplier_name));
        `);

        initialized = true;
      } catch (err) {
        console.error('❌ Failed to ensure supplier_evaluations table exists:', err);
        throw err;
      } finally {
        initializingPromise = null;
      }
    })();

    await initializingPromise;
  };
})();

const sanitizeText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
};

const parseScoreValue = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw createHttpError(
      400,
      `${fieldName} must be a number between 0 and 100`
    );
  }

  return Math.round(numeric * 100) / 100;
};

const parseDateStrict = (value, fieldName) => {
  if (!value) {
    throw createHttpError(400, `${fieldName} is required`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }

  return date.toISOString().slice(0, 10);
};

const getTodayISODate = () => new Date().toISOString().slice(0, 10);

const serializeEvaluation = (row) => {
  if (!row) {
    return null;
  }

  const toNumber = (value) =>
    value === null || value === undefined ? null : Number(value);

  return {
    id: row.id,
    supplier_name: row.supplier_name,
    evaluation_date: row.evaluation_date,
    quality_score: toNumber(row.quality_score),
    delivery_score: toNumber(row.delivery_score),
    cost_score: toNumber(row.cost_score),
    compliance_score: toNumber(row.compliance_score),
    overall_score: toNumber(row.overall_score),
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    action_items: row.action_items,
    evaluator_id: row.evaluator_id,
    evaluator_name: row.evaluator_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const computeOverallScore = (explicitOverall, componentScores) => {
  if (explicitOverall !== null && explicitOverall !== undefined) {
    return explicitOverall;
  }

  const scores = componentScores.filter(
    (score) => score !== null && score !== undefined
  );

  if (!scores.length) {
    throw createHttpError(
      400,
      'overall_score is required when no component scores are provided'
    );
  }

  const sum = scores.reduce((acc, score) => acc + score, 0);
  return Math.round((sum / scores.length) * 100) / 100;
};

const listSupplierEvaluations = async (req, res, next) => {
  try {
    await ensureSupplierEvaluationsTable();

    const filters = [];
    const values = [];

    const search = sanitizeText(req.query.search);
    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      filters.push(`LOWER(supplier_name) LIKE $${values.length}`);
    }

    const startDate = req.query.start_date
      ? parseDateStrict(req.query.start_date, 'start_date')
      : null;
    const endDate = req.query.end_date
      ? parseDateStrict(req.query.end_date, 'end_date')
      : null;

    if (startDate) {
      values.push(startDate);
      filters.push(`evaluation_date >= $${values.length}`);
    }

    if (endDate) {
      values.push(endDate);
      filters.push(`evaluation_date <= $${values.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, supplier_name, evaluation_date, quality_score, delivery_score,
              cost_score, compliance_score, overall_score, strengths, weaknesses,
              action_items, evaluator_id, evaluator_name, created_at, updated_at
         FROM supplier_evaluations
         ${whereClause}
        ORDER BY evaluation_date DESC, created_at DESC`,
      values
    );

    res.json(rows.map(serializeEvaluation));
  } catch (err) {
    console.error('❌ Failed to list supplier evaluations:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to load supplier evaluations'));
  }
};

const getSupplierEvaluationById = async (req, res, next) => {
  const evaluationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(evaluationId)) {
    return next(createHttpError(400, 'Invalid supplier evaluation id'));
  }

  try {
    await ensureSupplierEvaluationsTable();

    const { rows } = await pool.query(
      `SELECT id, supplier_name, evaluation_date, quality_score, delivery_score,
              cost_score, compliance_score, overall_score, strengths, weaknesses,
              action_items, evaluator_id, evaluator_name, created_at, updated_at
         FROM supplier_evaluations
        WHERE id = $1`,
      [evaluationId]
    );

    if (!rows.length) {
      return next(createHttpError(404, 'Supplier evaluation not found'));
    }

    res.json(serializeEvaluation(rows[0]));
  } catch (err) {
    console.error('❌ Failed to fetch supplier evaluation:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to fetch supplier evaluation'));
  }
};

const createSupplierEvaluation = async (req, res, next) => {
  if (!canManageSupplierEvaluations(req)) {
    return next(createHttpError(403, 'Insufficient permissions'));
  }

  try {
    const supplierName = sanitizeText(req.body?.supplier_name);
    if (!supplierName) {
      return next(createHttpError(400, 'supplier_name is required'));
    }

    const evaluationDate = req.body?.evaluation_date
      ? parseDateStrict(req.body.evaluation_date, 'evaluation_date')
      : getTodayISODate();

    const qualityScore = parseScoreValue(req.body?.quality_score, 'quality_score');
    const deliveryScore = parseScoreValue(
      req.body?.delivery_score,
      'delivery_score'
    );
    const costScore = parseScoreValue(req.body?.cost_score, 'cost_score');
    const complianceScore = parseScoreValue(
      req.body?.compliance_score,
      'compliance_score'
    );
    const explicitOverall = parseScoreValue(
      req.body?.overall_score,
      'overall_score'
    );

    const overallScore = computeOverallScore(explicitOverall, [
      qualityScore,
      deliveryScore,
      costScore,
      complianceScore,
    ]);

    const strengths = sanitizeText(req.body?.strengths);
    const weaknesses = sanitizeText(req.body?.weaknesses);
    const actionItems = sanitizeText(req.body?.action_items);

    await ensureSupplierEvaluationsTable();

    const { rows } = await pool.query(
      `INSERT INTO supplier_evaluations (
         supplier_name, evaluation_date, quality_score, delivery_score, cost_score,
         compliance_score, overall_score, strengths, weaknesses, action_items,
         evaluator_id, evaluator_name
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, supplier_name, evaluation_date, quality_score, delivery_score,
                 cost_score, compliance_score, overall_score, strengths, weaknesses,
                 action_items, evaluator_id, evaluator_name, created_at, updated_at`,
      [
        supplierName,
        evaluationDate,
        qualityScore,
        deliveryScore,
        costScore,
        complianceScore,
        overallScore,
        strengths,
        weaknesses,
        actionItems,
        req.user?.id ?? null,
        sanitizeText(req.user?.name),
      ]
    );

    res.status(201).json(serializeEvaluation(rows[0]));
  } catch (err) {
    console.error('❌ Failed to create supplier evaluation:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to create supplier evaluation'));
  }
};

const updateSupplierEvaluation = async (req, res, next) => {
  if (!canManageSupplierEvaluations(req)) {
    return next(createHttpError(403, 'Insufficient permissions'));
  }

  const evaluationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(evaluationId)) {
    return next(createHttpError(400, 'Invalid supplier evaluation id'));
  }

  try {
    await ensureSupplierEvaluationsTable();

    const existingResult = await pool.query(
      `SELECT id, supplier_name, evaluation_date, quality_score, delivery_score,
              cost_score, compliance_score, overall_score, strengths, weaknesses,
              action_items
         FROM supplier_evaluations
        WHERE id = $1`,
      [evaluationId]
    );

    if (!existingResult.rows.length) {
      return next(createHttpError(404, 'Supplier evaluation not found'));
    }

    const existing = existingResult.rows[0];

    let supplierName = existing.supplier_name;
    if (Object.prototype.hasOwnProperty.call(req.body, 'supplier_name')) {
      const sanitized = sanitizeText(req.body.supplier_name);
      if (!sanitized) {
        return next(createHttpError(400, 'supplier_name is required'));
      }
      supplierName = sanitized;
    }

    let evaluationDate = existing.evaluation_date;
    if (Object.prototype.hasOwnProperty.call(req.body, 'evaluation_date')) {
      evaluationDate = parseDateStrict(
        req.body.evaluation_date,
        'evaluation_date'
      );
    }

    const getUpdatedScore = (field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        return parseScoreValue(req.body[field], field);
      }
      const current = existing[field];
      return current === null || current === undefined ? null : Number(current);
    };

    const qualityScore = getUpdatedScore('quality_score');
    const deliveryScore = getUpdatedScore('delivery_score');
    const costScore = getUpdatedScore('cost_score');
    const complianceScore = getUpdatedScore('compliance_score');

    let overallScore;
    if (Object.prototype.hasOwnProperty.call(req.body, 'overall_score')) {
      overallScore = parseScoreValue(req.body.overall_score, 'overall_score');
    } else {
      const hasComponentUpdate = ['quality_score', 'delivery_score', 'cost_score', 'compliance_score'].some((field) =>
        Object.prototype.hasOwnProperty.call(req.body, field)
      );

      overallScore = hasComponentUpdate
        ? computeOverallScore(null, [
            qualityScore,
            deliveryScore,
            costScore,
            complianceScore,
          ])
        : Number(existing.overall_score);
    }

    const strengths = Object.prototype.hasOwnProperty.call(req.body, 'strengths')
      ? sanitizeText(req.body.strengths)
      : existing.strengths;
    const weaknesses = Object.prototype.hasOwnProperty.call(
      req.body,
      'weaknesses'
    )
      ? sanitizeText(req.body.weaknesses)
      : existing.weaknesses;
    const actionItems = Object.prototype.hasOwnProperty.call(
      req.body,
      'action_items'
    )
      ? sanitizeText(req.body.action_items)
      : existing.action_items;

    const { rows } = await pool.query(
      `UPDATE supplier_evaluations
          SET supplier_name = $1,
              evaluation_date = $2,
              quality_score = $3,
              delivery_score = $4,
              cost_score = $5,
              compliance_score = $6,
              overall_score = $7,
              strengths = $8,
              weaknesses = $9,
              action_items = $10,
              evaluator_id = $11,
              evaluator_name = $12,
              updated_at = NOW()
        WHERE id = $13
      RETURNING id, supplier_name, evaluation_date, quality_score, delivery_score,
                cost_score, compliance_score, overall_score, strengths, weaknesses,
                action_items, evaluator_id, evaluator_name, created_at, updated_at`,
      [
        supplierName,
        evaluationDate,
        qualityScore,
        deliveryScore,
        costScore,
        complianceScore,
        overallScore,
        strengths,
        weaknesses,
        actionItems,
        req.user?.id ?? null,
        sanitizeText(req.user?.name),
        evaluationId,
      ]
    );

    res.json(serializeEvaluation(rows[0]));
  } catch (err) {
    console.error('❌ Failed to update supplier evaluation:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to update supplier evaluation'));
  }
};

const deleteSupplierEvaluation = async (req, res, next) => {
  if (!canManageSupplierEvaluations(req)) {
    return next(createHttpError(403, 'Insufficient permissions'));
  }

  const evaluationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(evaluationId)) {
    return next(createHttpError(400, 'Invalid supplier evaluation id'));
  }

  try {
    await ensureSupplierEvaluationsTable();

    const { rowCount } = await pool.query(
      'DELETE FROM supplier_evaluations WHERE id = $1',
      [evaluationId]
    );

    if (rowCount === 0) {
      return next(createHttpError(404, 'Supplier evaluation not found'));
    }

    res.status(204).send();
  } catch (err) {
    console.error('❌ Failed to delete supplier evaluation:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to delete supplier evaluation'));
  }
};

module.exports = {
  listSupplierEvaluations,
  getSupplierEvaluationById,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  deleteSupplierEvaluation,
  // Exported for testing purposes
  _internal: {
    parseScoreValue,
    computeOverallScore,
    sanitizeText,
  },
};