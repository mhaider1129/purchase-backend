const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const canManageSupplierEvaluations = (req) =>
  Boolean(req.user?.hasPermission && req.user.hasPermission('evaluations.manage'));

const KPI_CONFIG = [
  {
    key: 'otif',
    scoreField: 'otif_score',
    weightField: 'otif_weight',
    defaultWeight: 0.4,
  },
  {
    key: 'corrective_actions',
    scoreField: 'corrective_actions_score',
    weightField: 'corrective_actions_weight',
    defaultWeight: 0.35,
  },
  {
    key: 'esg_compliance',
    scoreField: 'esg_compliance_score',
    weightField: 'esg_compliance_weight',
    defaultWeight: 0.25,
  },
];

const CRITERIA_SCALE_FIELDS = [
  {
    key: 'overall_supplier_happiness',
    label: 'Overall, how happy are you with the supplier?',
  },
  {
    key: 'price_satisfaction',
    label: 'How satisfied are you with the price of the goods/services?',
  },
  {
    key: 'delivery_as_scheduled',
    label: 'Does the supplier deliver the goods/services as scheduled?',
  },
  {
    key: 'delivery_in_good_condition',
    label: 'Does the supplier deliver the goods/services in good condition?',
  },
  {
    key: 'delivery_meets_quality_expectations',
    label: 'Does the supplier deliver the goods/services within acceptable quality?',
  },
  {
    key: 'communication_effectiveness',
    label: 'How effective is the supplier communication?',
  },
  {
    key: 'compliance_alignment',
    label: 'Does the supplier comply with requirements and regulations?',
  },
  {
    key: 'operations_effectiveness_rating',
    label: 'How effective are the supplier operations?',
  },
  {
    key: 'payment_terms_comfort',
    label: 'How comfortable are you with the payment terms?',
  },
];

const DEFAULT_CRITERIA_RESPONSES = CRITERIA_SCALE_FIELDS.reduce(
  (acc, field) => ({
    ...acc,
    [field.key]: null,
  }),
  {
    scheduled_annually: true,
    travel_required: false,
    evaluation_criteria_notes: null,
  }
);

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
            otif_score NUMERIC(5, 2),
            corrective_actions_score NUMERIC(5, 2),
            esg_compliance_score NUMERIC(5, 2),
            overall_score NUMERIC(5, 2) NOT NULL,
            weighted_overall_score NUMERIC(5, 2),
            kpi_weights JSONB,
            strengths TEXT,
            weaknesses TEXT,
            action_items TEXT,
            scheduled_annually BOOLEAN NOT NULL DEFAULT TRUE,
            travel_required BOOLEAN DEFAULT FALSE,
            evaluation_criteria_notes TEXT,
            overall_supplier_happiness NUMERIC(3, 1),
            price_satisfaction NUMERIC(3, 1),
            delivery_as_scheduled NUMERIC(3, 1),
            delivery_in_good_condition NUMERIC(3, 1),
            delivery_meets_quality_expectations NUMERIC(3, 1),
            communication_effectiveness NUMERIC(3, 1),
            compliance_alignment NUMERIC(3, 1),
            operations_effectiveness_rating NUMERIC(3, 1),
            payment_terms_comfort NUMERIC(3, 1),
            criteria_responses JSONB,
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

        await pool.query(`
          ALTER TABLE supplier_evaluations
            ADD COLUMN IF NOT EXISTS otif_score NUMERIC(5, 2),
            ADD COLUMN IF NOT EXISTS corrective_actions_score NUMERIC(5, 2),
            ADD COLUMN IF NOT EXISTS esg_compliance_score NUMERIC(5, 2),
            ADD COLUMN IF NOT EXISTS weighted_overall_score NUMERIC(5, 2),
            ADD COLUMN IF NOT EXISTS kpi_weights JSONB,
            ADD COLUMN IF NOT EXISTS criteria_responses JSONB,
            ADD COLUMN IF NOT EXISTS scheduled_annually BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS travel_required BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS evaluation_criteria_notes TEXT,
            ADD COLUMN IF NOT EXISTS overall_supplier_happiness NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS price_satisfaction NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS delivery_as_scheduled NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS delivery_in_good_condition NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS delivery_meets_quality_expectations NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS communication_effectiveness NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS compliance_alignment NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS operations_effectiveness_rating NUMERIC(3, 1),
            ADD COLUMN IF NOT EXISTS payment_terms_comfort NUMERIC(3, 1)
        `);

        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_overall_supplier_happiness_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_overall_supplier_happiness_scale
                  CHECK (overall_supplier_happiness IS NULL OR (overall_supplier_happiness >= 1 AND overall_supplier_happiness <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_price_satisfaction_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_price_satisfaction_scale
                  CHECK (price_satisfaction IS NULL OR (price_satisfaction >= 1 AND price_satisfaction <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_delivery_as_scheduled_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_delivery_as_scheduled_scale
                  CHECK (delivery_as_scheduled IS NULL OR (delivery_as_scheduled >= 1 AND delivery_as_scheduled <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_delivery_in_good_condition_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_delivery_in_good_condition_scale
                  CHECK (delivery_in_good_condition IS NULL OR (delivery_in_good_condition >= 1 AND delivery_in_good_condition <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_delivery_quality_expectations_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_delivery_quality_expectations_scale
                  CHECK (delivery_meets_quality_expectations IS NULL OR (delivery_meets_quality_expectations >= 1 AND delivery_meets_quality_expectations <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_communication_effectiveness_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_communication_effectiveness_scale
                  CHECK (communication_effectiveness IS NULL OR (communication_effectiveness >= 1 AND communication_effectiveness <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_compliance_alignment_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_compliance_alignment_scale
                  CHECK (compliance_alignment IS NULL OR (compliance_alignment >= 1 AND compliance_alignment <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_operations_effectiveness_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_operations_effectiveness_scale
                  CHECK (operations_effectiveness_rating IS NULL OR (operations_effectiveness_rating >= 1 AND operations_effectiveness_rating <= 5));
            END IF;

            IF NOT EXISTS (
              SELECT 1
                FROM information_schema.check_constraints
               WHERE constraint_name = 'chk_supplier_eval_payment_terms_comfort_scale'
            ) THEN
              ALTER TABLE supplier_evaluations
                ADD CONSTRAINT chk_supplier_eval_payment_terms_comfort_scale
                  CHECK (payment_terms_comfort IS NULL OR (payment_terms_comfort >= 1 AND payment_terms_comfort <= 5));
            END IF;
          END $$;
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

const parseWeightPercentage = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw createHttpError(
      400,
      `${fieldName} must be a positive number no greater than 100`
    );
  }

  const decimal = numeric > 1 ? numeric / 100 : numeric;
  return Math.round(decimal * 1000) / 1000;
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

const parseBoolean = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw createHttpError(400, `${fieldName} is required`);
    }
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'on'].includes(normalized)) {
    return true;
  }

  if (['no', 'false', '0', 'off'].includes(normalized)) {
    return false;
  }

  throw createHttpError(400, `${fieldName} must be a yes/no value`);
};

const parseSatisfactionRating = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(400, `${fieldName} is required`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) {
    throw createHttpError(400, `${fieldName} must be a number between 1 and 5`);
  }

  return Math.round(numeric * 10) / 10;
};

const parseCriteriaResponses = (payload) => {
  const data = {
    ...DEFAULT_CRITERIA_RESPONSES,
    ...(payload?.criteria_responses || payload || {}),
  };

  const scheduledAnnually = parseBoolean(data.scheduled_annually, 'scheduled_annually', {
    required: true,
  });

  if (!scheduledAnnually) {
    throw createHttpError(
      400,
      'Suppliers must be scheduled for at least one evaluation every year'
    );
  }

  const ratings = CRITERIA_SCALE_FIELDS.reduce((acc, field) => {
    acc[field.key] = parseSatisfactionRating(data[field.key], field.label);
    return acc;
  }, {});

  return {
    scheduled_annually: scheduledAnnually,
    travel_required: parseBoolean(data.travel_required, 'travel_required') ?? false,
    evaluation_criteria_notes: sanitizeText(data.evaluation_criteria_notes),
    ...ratings,
  };
};

const assertAnnualCadence = async (supplierName, evaluationDate, excludeId = null) => {
  const values = [supplierName.toLowerCase()];
  let filter = 'LOWER(supplier_name) = $1';

  if (excludeId !== null && excludeId !== undefined) {
    values.push(excludeId);
    filter += ` AND id <> $${values.length}`;
  }

  const { rows } = await pool.query(
    `SELECT MAX(evaluation_date) AS latest_date
       FROM supplier_evaluations
      WHERE ${filter}`,
    values
  );

  const latestDate = rows[0]?.latest_date;
  if (!latestDate) {
    return;
  }

  const latest = new Date(latestDate);
  const current = new Date(evaluationDate);
  const diffMs = current.getTime() - latest.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);

  if (days > 366) {
    throw createHttpError(
      400,
      `Each supplier must be evaluated at least annually. The last evaluation for ${supplierName} was on ${formatDateOnly(
        latest
      )}.`
    );
  }
};

const formatDateOnly = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const parseJsonField = (value, label) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn(`⚠️ Failed to parse ${label} JSON payload`, err);
      return null;
    }
  }

  return value;
};

const buildCriteriaFromRow = (row) => {
  const criteriaFromJson = parseJsonField(row.criteria_responses, 'criteria_responses');

  const merged = {
    ...DEFAULT_CRITERIA_RESPONSES,
    ...(criteriaFromJson || {}),
  };

  if (row.scheduled_annually !== null && row.scheduled_annually !== undefined) {
    merged.scheduled_annually = Boolean(row.scheduled_annually);
  }

  if (row.travel_required !== null && row.travel_required !== undefined) {
    merged.travel_required = Boolean(row.travel_required);
  }

  if (row.evaluation_criteria_notes !== null && row.evaluation_criteria_notes !== undefined) {
    merged.evaluation_criteria_notes = row.evaluation_criteria_notes;
  }

  CRITERIA_SCALE_FIELDS.forEach(({ key }) => {
    if (row[key] !== null && row[key] !== undefined) {
      merged[key] = Number(row[key]);
    }
  });

  return merged;
};

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
    otif_score: toNumber(row.otif_score),
    corrective_actions_score: toNumber(row.corrective_actions_score),
    esg_compliance_score: toNumber(row.esg_compliance_score),
    overall_score: toNumber(row.overall_score),
    weighted_overall_score: toNumber(row.weighted_overall_score),
    kpi_weights: parseJsonField(row.kpi_weights, 'kpi_weights'),
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    action_items: row.action_items,
    criteria_responses: buildCriteriaFromRow(row),
    evaluator_id: row.evaluator_id,
    evaluator_name: row.evaluator_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const computeWeightedKpiSummary = (scores, weightOverrides) => {
  const metrics = [];

  KPI_CONFIG.forEach(({ key, scoreField, weightField, defaultWeight }) => {
    const score = scores[scoreField];
    if (score === null || score === undefined) {
      return;
    }

    let weight = defaultWeight;
    if (Object.prototype.hasOwnProperty.call(weightOverrides, weightField)) {
      const overrideValue = weightOverrides[weightField];
      if (overrideValue !== null && overrideValue !== undefined) {
        weight = overrideValue;
      }
    }

    metrics.push({ key, score, weight });
  });

  if (!metrics.length) {
    return { weightedScore: null, normalizedWeights: null };
  }

  const totalWeight = metrics.reduce((acc, metric) => acc + metric.weight, 0);
  if (totalWeight <= 0) {
    throw createHttpError(
      400,
      'At least one KPI weight must be greater than zero to compute a weighted score'
    );
  }

  const normalizedWeights = {};
  let weightedSum = 0;

  metrics.forEach((metric) => {
    const normalizedWeight = metric.weight / totalWeight;
    normalizedWeights[metric.key] = Math.round(normalizedWeight * 1000) / 1000;
    weightedSum += metric.score * normalizedWeight;
  });

  return {
    weightedScore: Math.round(weightedSum * 100) / 100,
    normalizedWeights,
  };
};

const resolveOverallScores = (
  explicitOverall,
  componentScores,
  kpiScores,
  weightOverrides
) => {
  const { weightedScore, normalizedWeights } =
    computeWeightedKpiSummary(kpiScores, weightOverrides);

  if (explicitOverall !== null && explicitOverall !== undefined) {
    return {
      overallScore: explicitOverall,
      weightedOverallScore: weightedScore,
      normalizedWeights,
    };
  }

  if (weightedScore !== null && weightedScore !== undefined) {
    return {
      overallScore: weightedScore,
      weightedOverallScore: weightedScore,
      normalizedWeights,
    };
  }

  const fallbackScores = componentScores.filter(
    (score) => score !== null && score !== undefined
  );

  if (!fallbackScores.length) {
    throw createHttpError(
      400,
      'Provide either an overall score, at least one KPI score, or component scores to evaluate the supplier'
    );
  }

  const sum = fallbackScores.reduce((acc, score) => acc + score, 0);
  const average = Math.round((sum / fallbackScores.length) * 100) / 100;

  return {
    overallScore: average,
    weightedOverallScore: null,
    normalizedWeights: null,
  };
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
              cost_score, compliance_score, otif_score, corrective_actions_score,
              esg_compliance_score, overall_score, weighted_overall_score,
              kpi_weights, strengths, weaknesses, action_items, criteria_responses,
              evaluator_id, evaluator_name, created_at, updated_at,
              scheduled_annually, travel_required, evaluation_criteria_notes,
              overall_supplier_happiness, price_satisfaction,
              delivery_as_scheduled, delivery_in_good_condition,
              delivery_meets_quality_expectations, communication_effectiveness,
              compliance_alignment, operations_effectiveness_rating,
              payment_terms_comfort
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

const getSupplierEvaluationBenchmarks = async (req, res, next) => {
  try {
    await ensureSupplierEvaluationsTable();

    const filters = [];
    const values = [];

    const supplierName = sanitizeText(req.query?.supplier_name);
    if (supplierName) {
      values.push(supplierName.toLowerCase());
      filters.push(`LOWER(supplier_name) = $${values.length}`);
    }

    const startDate = req.query?.start_date
      ? parseDateStrict(req.query.start_date, 'start_date')
      : null;
    if (startDate) {
      values.push(startDate);
      filters.push(`evaluation_date >= $${values.length}`);
    }

    const endDate = req.query?.end_date
      ? parseDateStrict(req.query.end_date, 'end_date')
      : null;
    if (endDate) {
      values.push(endDate);
      filters.push(`evaluation_date <= $${values.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const intervalInput = sanitizeText(req.query?.interval)?.toLowerCase();
    const interval = ['month', 'quarter', 'year'].includes(intervalInput)
      ? intervalInput
      : 'month';

    const limit = Number.parseInt(req.query?.limit, 10);
    const limitClause = Number.isInteger(limit) && limit > 0 ? `LIMIT ${limit}` : '';

    const bucketExpression = `date_trunc('${interval}', evaluation_date)`;

    const { rows } = await pool.query(
      `SELECT supplier_name,
              ${bucketExpression} AS period_start,
              COUNT(*) AS evaluation_count,
              AVG(otif_score) AS avg_otif_score,
              AVG(corrective_actions_score) AS avg_corrective_actions_score,
              AVG(esg_compliance_score) AS avg_esg_compliance_score,
              AVG(overall_score) AS avg_overall_score,
              AVG(weighted_overall_score) AS avg_weighted_overall_score
         FROM supplier_evaluations
         ${whereClause}
        GROUP BY supplier_name, period_start
        ORDER BY supplier_name ASC, period_start ASC
        ${limitClause}`,
      values
    );

    const toNumber = (value) =>
      value === null || value === undefined ? null : Number(value);

    res.json(
      rows.map((row) => ({
        supplier_name: row.supplier_name,
        period_start: formatDateOnly(row.period_start),
        interval,
        evaluation_count: Number(row.evaluation_count) || 0,
        avg_otif_score: toNumber(row.avg_otif_score),
        avg_corrective_actions_score: toNumber(
          row.avg_corrective_actions_score
        ),
        avg_esg_compliance_score: toNumber(row.avg_esg_compliance_score),
        avg_overall_score: toNumber(row.avg_overall_score),
        avg_weighted_overall_score: toNumber(row.avg_weighted_overall_score),
      }))
    );
  } catch (err) {
    console.error('❌ Failed to compute supplier benchmark trends:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to compute supplier benchmark data'));
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
              cost_score, compliance_score, otif_score, corrective_actions_score,
              esg_compliance_score, overall_score, weighted_overall_score,
              kpi_weights, strengths, weaknesses, action_items, criteria_responses,
              evaluator_id, created_at, updated_at, evaluator_name,
              scheduled_annually, travel_required, evaluation_criteria_notes,
              overall_supplier_happiness, price_satisfaction,
              delivery_as_scheduled, delivery_in_good_condition,
              delivery_meets_quality_expectations, communication_effectiveness,
              compliance_alignment, operations_effectiveness_rating,
              payment_terms_comfort
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
    const otifScore = parseScoreValue(req.body?.otif_score, 'otif_score');
    const correctiveActionsScore = parseScoreValue(
      req.body?.corrective_actions_score,
      'corrective_actions_score'
    );
    const esgComplianceScore = parseScoreValue(
      req.body?.esg_compliance_score,
      'esg_compliance_score'
    );

    const weightOverrides = {
      otif_weight: parseWeightPercentage(req.body?.otif_weight, 'otif_weight'),
      corrective_actions_weight: parseWeightPercentage(
        req.body?.corrective_actions_weight,
        'corrective_actions_weight'
      ),
      esg_compliance_weight: parseWeightPercentage(
        req.body?.esg_compliance_weight,
        'esg_compliance_weight'
      ),
    };

    const explicitOverall = parseScoreValue(
      req.body?.overall_score,
      'overall_score'
    );

    const criteriaResponses = parseCriteriaResponses(req.body);

    const {
      overallScore,
      weightedOverallScore,
      normalizedWeights,
    } = resolveOverallScores(
      explicitOverall,
      [qualityScore, deliveryScore, costScore, complianceScore],
      {
        otif_score: otifScore,
        corrective_actions_score: correctiveActionsScore,
        esg_compliance_score: esgComplianceScore,
      },
      weightOverrides
    );

    const strengths = sanitizeText(req.body?.strengths);
    const weaknesses = sanitizeText(req.body?.weaknesses);
    const actionItems = sanitizeText(req.body?.action_items);

    await ensureSupplierEvaluationsTable();

    await assertAnnualCadence(supplierName, evaluationDate);

    const { rows } = await pool.query(
      `INSERT INTO supplier_evaluations (
         supplier_name, evaluation_date, quality_score, delivery_score, cost_score,
         compliance_score, otif_score, corrective_actions_score, esg_compliance_score,
         overall_score, weighted_overall_score, kpi_weights, strengths, weaknesses,
         action_items, scheduled_annually, travel_required, evaluation_criteria_notes,
         overall_supplier_happiness, price_satisfaction, delivery_as_scheduled,
         delivery_in_good_condition, delivery_meets_quality_expectations,
         communication_effectiveness, compliance_alignment,
         operations_effectiveness_rating, payment_terms_comfort, criteria_responses,
         evaluator_id, evaluator_name
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
       )
       RETURNING id, supplier_name, evaluation_date, quality_score, delivery_score,
                 cost_score, compliance_score, otif_score, corrective_actions_score,
                 esg_compliance_score, overall_score, weighted_overall_score,
                 kpi_weights, strengths, weaknesses, action_items, criteria_responses,
                 evaluator_id, evaluator_name, created_at, updated_at,
                 scheduled_annually, travel_required, evaluation_criteria_notes,
                 overall_supplier_happiness, price_satisfaction,
                 delivery_as_scheduled, delivery_in_good_condition,
                 delivery_meets_quality_expectations, communication_effectiveness,
                 compliance_alignment, operations_effectiveness_rating,
                 payment_terms_comfort`,
      [
        supplierName,
        evaluationDate,
        qualityScore,
        deliveryScore,
        costScore,
        complianceScore,
        otifScore,
        correctiveActionsScore,
        esgComplianceScore,
        overallScore,
        weightedOverallScore,
        normalizedWeights ? JSON.stringify(normalizedWeights) : null,
        strengths,
        weaknesses,
        actionItems,
        criteriaResponses.scheduled_annually,
        criteriaResponses.travel_required,
        criteriaResponses.evaluation_criteria_notes,
        criteriaResponses.overall_supplier_happiness,
        criteriaResponses.price_satisfaction,
        criteriaResponses.delivery_as_scheduled,
        criteriaResponses.delivery_in_good_condition,
        criteriaResponses.delivery_meets_quality_expectations,
        criteriaResponses.communication_effectiveness,
        criteriaResponses.compliance_alignment,
        criteriaResponses.operations_effectiveness_rating,
        criteriaResponses.payment_terms_comfort,
        criteriaResponses ? JSON.stringify(criteriaResponses) : null,
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
              cost_score, compliance_score, otif_score, corrective_actions_score,
              esg_compliance_score, overall_score, weighted_overall_score,
              kpi_weights, strengths, weaknesses, action_items, criteria_responses,
              scheduled_annually, travel_required, evaluation_criteria_notes,
              overall_supplier_happiness, price_satisfaction,
              delivery_as_scheduled, delivery_in_good_condition,
              delivery_meets_quality_expectations, communication_effectiveness,
              compliance_alignment, operations_effectiveness_rating,
              payment_terms_comfort
         FROM supplier_evaluations
        WHERE id = $1`,
      [evaluationId]
    );

    if (!existingResult.rows.length) {
      return next(createHttpError(404, 'Supplier evaluation not found'));
    }

    const existing = existingResult.rows[0];
    const existingWeightsRaw = existing.kpi_weights;
    let existingWeights = null;
    if (existingWeightsRaw) {
      if (typeof existingWeightsRaw === 'string') {
        try {
          existingWeights = JSON.parse(existingWeightsRaw);
        } catch (err) {
          console.warn('⚠️ Unable to parse stored KPI weights, discarding value', err);
          existingWeights = null;
        }
      } else {
        existingWeights = existingWeightsRaw;
      }
    }

    const existingCriteria = buildCriteriaFromRow(existing);

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
    const otifScore = getUpdatedScore('otif_score');
    const correctiveActionsScore = getUpdatedScore('corrective_actions_score');
    const esgComplianceScore = getUpdatedScore('esg_compliance_score');

    const weightOverrides = {};
    KPI_CONFIG.forEach(({ key, weightField }) => {
      if (Object.prototype.hasOwnProperty.call(req.body, weightField)) {
        weightOverrides[weightField] = parseWeightPercentage(
          req.body[weightField],
          weightField
        );
      } else if (existingWeights && existingWeights[key] !== undefined) {
        weightOverrides[weightField] = Number(existingWeights[key]);
      } else {
        weightOverrides[weightField] = null;
      }
    });

    const hasScoreUpdate =
      ['quality_score', 'delivery_score', 'cost_score', 'compliance_score'].some(
        (field) => Object.prototype.hasOwnProperty.call(req.body, field)
      ) ||
      KPI_CONFIG.some(({ scoreField }) =>
        Object.prototype.hasOwnProperty.call(req.body, scoreField)
      );
    const hasWeightUpdate = KPI_CONFIG.some(({ weightField }) =>
      Object.prototype.hasOwnProperty.call(req.body, weightField)
    );

    const explicitOverall = Object.prototype.hasOwnProperty.call(
      req.body,
      'overall_score'
    )
      ? parseScoreValue(req.body.overall_score, 'overall_score')
      : hasScoreUpdate || hasWeightUpdate
      ? null
      : Number(existing.overall_score);

    const {
      overallScore,
      weightedOverallScore,
      normalizedWeights,
    } = resolveOverallScores(
      explicitOverall,
      [qualityScore, deliveryScore, costScore, complianceScore],
      {
        otif_score: otifScore,
        corrective_actions_score: correctiveActionsScore,
        esg_compliance_score: esgComplianceScore,
      },
      weightOverrides
    );

    const weightsToPersist = normalizedWeights
      ? normalizedWeights
      : hasScoreUpdate || hasWeightUpdate
      ? null
      : existingWeights;

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

    const criteriaResponses = parseCriteriaResponses({
      ...existingCriteria,
      ...(req.body?.criteria_responses || {}),
    });

    await assertAnnualCadence(supplierName, evaluationDate, evaluationId);

    const { rows } = await pool.query(
      `UPDATE supplier_evaluations
          SET supplier_name = $1,
              evaluation_date = $2,
              quality_score = $3,
              delivery_score = $4,
              cost_score = $5,
              compliance_score = $6,
              otif_score = $7,
              corrective_actions_score = $8,
              esg_compliance_score = $9,
              overall_score = $10,
              weighted_overall_score = $11,
              kpi_weights = $12,
              strengths = $13,
              weaknesses = $14,
              action_items = $15,
              scheduled_annually = $16,
              travel_required = $17,
              evaluation_criteria_notes = $18,
              overall_supplier_happiness = $19,
              price_satisfaction = $20,
              delivery_as_scheduled = $21,
              delivery_in_good_condition = $22,
              delivery_meets_quality_expectations = $23,
              communication_effectiveness = $24,
              compliance_alignment = $25,
              operations_effectiveness_rating = $26,
              payment_terms_comfort = $27,
              criteria_responses = $28,
              evaluator_id = $29,
              evaluator_name = $30,
              updated_at = NOW()
        WHERE id = $31
      RETURNING id, supplier_name, evaluation_date, quality_score, delivery_score,
                cost_score, compliance_score, otif_score, corrective_actions_score,
                esg_compliance_score, overall_score, weighted_overall_score,
                kpi_weights, strengths, weaknesses, action_items, criteria_responses,
                evaluator_id, evaluator_name, created_at, updated_at,
                scheduled_annually, travel_required, evaluation_criteria_notes,
                overall_supplier_happiness, price_satisfaction,
                delivery_as_scheduled, delivery_in_good_condition,
                delivery_meets_quality_expectations, communication_effectiveness,
                compliance_alignment, operations_effectiveness_rating,
                payment_terms_comfort`,
      [
        supplierName,
        evaluationDate,
        qualityScore,
        deliveryScore,
        costScore,
        complianceScore,
        otifScore,
        correctiveActionsScore,
        esgComplianceScore,
        overallScore,
        weightedOverallScore,
        weightsToPersist ? JSON.stringify(weightsToPersist) : null,
        strengths,
        weaknesses,
        actionItems,
        criteriaResponses.scheduled_annually,
        criteriaResponses.travel_required,
        criteriaResponses.evaluation_criteria_notes,
        criteriaResponses.overall_supplier_happiness,
        criteriaResponses.price_satisfaction,
        criteriaResponses.delivery_as_scheduled,
        criteriaResponses.delivery_in_good_condition,
        criteriaResponses.delivery_meets_quality_expectations,
        criteriaResponses.communication_effectiveness,
        criteriaResponses.compliance_alignment,
        criteriaResponses.operations_effectiveness_rating,
        criteriaResponses.payment_terms_comfort,
        criteriaResponses ? JSON.stringify(criteriaResponses) : null,
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
  getSupplierEvaluationBenchmarks,
  getSupplierEvaluationById,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  deleteSupplierEvaluation,
  // Exported for testing purposes
  _internal: {
    parseScoreValue,
    resolveOverallScores,
    computeWeightedKpiSummary,
    sanitizeText,
    parseWeightPercentage,
    parseCriteriaResponses,
  },
};