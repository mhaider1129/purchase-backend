const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const normalizeRoleToken = role =>
  (role || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const canManageContractEvaluations = req => {
  const allowedRoleTokens = new Set([
    'SCM',
    'COO',
    'ADMIN',
    'CONTRACTMANAGER',
    'PROCUREMENTSPECIALIST',
    'MEDICALDEVICES',
  ]);

  const roleToken = normalizeRoleToken(req.user?.role);
  return allowedRoleTokens.has(roleToken);
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

const normalizeTechnicalInspectionResults = input => {
  const value = parseJsonValue(input);
  if (!value || typeof value !== 'object') {
    return null;
  }

  const normalizeIssues = issues => {
    if (!Array.isArray(issues)) return [];
    return issues
      .map(issue => {
        if (typeof issue === 'string') {
          const summary = issue.trim();
          return summary ? { summary, severity: null } : null;
        }

        if (issue && typeof issue === 'object') {
          const summary = (issue.summary || issue.finding || issue.issue || '').trim();
          const severity = (issue.severity || issue.level || '').toString().trim();
          if (!summary) return null;
          return { summary, severity: severity || null };
        }

        return null;
      })
      .filter(Boolean);
  };

  const normalizeChecklist = checklist => {
    if (!Array.isArray(checklist)) return [];
    return checklist
      .map(entry => {
        if (!entry || typeof entry !== 'object') return null;

        const item = (entry.item || entry.name || '').trim();
        const condition = (entry.condition || '').trim();
        if (!item) return null;

        return {
          item,
          condition: condition || null,
        };
      })
      .filter(Boolean);
  };

  const latestInspectionDate = value.latest_inspection_date || value.inspection_date || value.date || null;

  return {
    latest_inspection_date: latestInspectionDate ? new Date(latestInspectionDate).toISOString().slice(0, 10) : null,
    overall_condition:
      typeof value.overall_condition === 'string'
        ? value.overall_condition
        : typeof value.summary?.overall_condition === 'string'
          ? value.summary.overall_condition
          : null,
    issues: normalizeIssues(value.issues || value.findings || value.flags),
    checklist: normalizeChecklist(value.checklist || value.general_checklist || value.category_checklist),
    summary: typeof value.summary === 'string' ? value.summary : value.summary?.notes || null,
  };
};

const normalizeFulfillmentMetrics = input => {
  const value = parseJsonValue(input);
  if (!value || typeof value !== 'object') {
    return null;
  }

  const numberOrNull = field => {
    const numeric = Number(field);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const completionRate = numberOrNull(value.completion_rate ?? value.fulfillment_rate);
  const total = numberOrNull(value.total_requests ?? value.total ?? value.volume);
  const completed = numberOrNull(value.completed_requests ?? value.completed);

  return {
    completion_rate: completionRate,
    total_requests: total,
    completed_requests: completed,
    average_lead_time_days: numberOrNull(value.average_lead_time_days ?? value.lead_time),
    on_time_rate: numberOrNull(value.on_time_rate ?? value.ontime_rate),
    notes: typeof value.notes === 'string' ? value.notes.trim() || null : null,
  };
};

const deriveTechnicalInspectionResults = async vendor => {
  if (!vendor) return null;

  try {
    const { rows } = await pool.query(
      `SELECT inspection_date, summary, general_checklist, category_checklist
         FROM technical_inspections
        WHERE LOWER(supplier_name) = LOWER($1)
        ORDER BY inspection_date DESC, id DESC
        LIMIT 1`,
      [vendor]
    );

    if (!rows.length) {
      return null;
    }

    const inspection = rows[0];
    const generalChecklist = parseJsonValue(inspection.general_checklist) || [];
    const categoryChecklist = parseJsonValue(inspection.category_checklist) || [];
    const combinedChecklist = [...generalChecklist, ...categoryChecklist];

    const issues = combinedChecklist
      .filter(entry => ['poor', 'fair'].includes((entry?.condition || '').toLowerCase()))
      .map(entry => ({
        summary: entry?.item || entry?.name || 'Checklist issue',
        severity: entry?.condition || null,
      }));

    return normalizeTechnicalInspectionResults({
      inspection_date: inspection.inspection_date,
      summary: inspection.summary,
      checklist: combinedChecklist,
      issues,
    });
  } catch (err) {
    console.warn('⚠️ Unable to derive technical inspection results:', err.message);
    return null;
  }
};

const deriveFulfillmentMetrics = async departmentId => {
  if (!departmentId) return null;

  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
         AVG(extract(epoch FROM (updated_at - created_at)) / 86400) FILTER (WHERE status = 'Completed') AS avg_lead_time_days
       FROM requests
       WHERE department_id = $1`,
      [departmentId]
    );

    const stats = rows[0];
    if (!stats) return null;

    const completionRate = stats.total > 0 ? Number(((stats.completed / stats.total) * 100).toFixed(2)) : null;

    return {
      completion_rate: completionRate,
      total_requests: stats.total || 0,
      completed_requests: stats.completed || 0,
      average_lead_time_days: stats.avg_lead_time_days ? Number(stats.avg_lead_time_days.toFixed(2)) : null,
      on_time_rate: null,
      notes: null,
    };
  } catch (err) {
    console.warn('⚠️ Unable to derive fulfillment metrics:', err.message);
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

  const criterionCode =
    base.criterionCode ||
    base.code ||
    base.criterion_code ||
    criterionMeta.code ||
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
    criterionCode,
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
      code: row.criterion_code,
    }
  );

  return {
    ...row,
    evaluation_criteria: evaluationCriteria,
    technical_inspection_results: normalizeTechnicalInspectionResults(row.technical_inspection_results),
    request_fulfillment_metrics: normalizeFulfillmentMetrics(row.request_fulfillment_metrics),
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
            criterion_code TEXT,
            technical_inspection_results JSONB,
            request_fulfillment_metrics JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          ALTER TABLE contract_evaluations
            ADD COLUMN IF NOT EXISTS criterion_id INTEGER REFERENCES evaluation_criteria(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS criterion_name TEXT,
            ADD COLUMN IF NOT EXISTS criterion_role TEXT,
            ADD COLUMN IF NOT EXISTS criterion_code TEXT,
            ADD COLUMN IF NOT EXISTS technical_inspection_results JSONB,
            ADD COLUMN IF NOT EXISTS request_fulfillment_metrics JSONB
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
    const contractRes = await pool.query(
      `SELECT id, vendor, title, end_user_department_id
         FROM contracts
        WHERE id = $1`,
      [contract_id]
    );

    if (contractRes.rowCount === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    const contract = contractRes.rows[0];
    let criterionMeta = { id: null, name: null, role: null, components: [] };

    if (criterion_id) {
      const { rows: criterionRows } = await pool.query(
        'SELECT id, name, role, code, components FROM evaluation_criteria WHERE id = $1',
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
        code: criterion.code,
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
      `INSERT INTO contract_evaluations (contract_id, evaluator_id, evaluation_criteria, criterion_id, criterion_name, criterion_role, criterion_code, technical_inspection_results, request_fulfillment_metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        contract_id,
        evaluator_id,
        normalizedCriteria,
        normalizedCriteria.criterionId,
        normalizedCriteria.criterionName,
        normalizedCriteria.criterionRole,
        normalizedCriteria.criterionCode,
        normalizeTechnicalInspectionResults(
          req.body?.technical_inspection_results
        ) || (await deriveTechnicalInspectionResults(contract.vendor)),
        normalizeFulfillmentMetrics(req.body?.request_fulfillment_metrics) ||
          (await deriveFulfillmentMetrics(contract.end_user_department_id)),
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
      `SELECT evaluator_id, contract_id, criterion_id, criterion_name, criterion_role, criterion_code, evaluation_criteria, technical_inspection_results, request_fulfillment_metrics
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

    let normalizedCriteria = normalizeEvaluationCriteriaStructure(parseJsonValue(evaluation_criteria), {
      id: existing.criterion_id,
      name: existing.criterion_name,
      role: existing.criterion_role,
      code: existing.criterion_code,
      components: normalizeEvaluationCriteriaStructure(parseJsonValue(existing.evaluation_criteria), {
        id: existing.criterion_id,
        name: existing.criterion_name,
        role: existing.criterion_role,
        code: existing.criterion_code,
      }).components,
    });

    const contractRes = await pool.query('SELECT vendor, end_user_department_id FROM contracts WHERE id = $1', [existing.contract_id]);
    const contractRow = contractRes.rows?.[0] || {};

    const normalizedTechnicalResults =
      normalizeTechnicalInspectionResults(req.body?.technical_inspection_results) ||
      normalizeTechnicalInspectionResults(existing.technical_inspection_results) ||
      (await deriveTechnicalInspectionResults(contractRow.vendor));

    const normalizedFulfillmentMetrics =
      normalizeFulfillmentMetrics(req.body?.request_fulfillment_metrics) ||
      normalizeFulfillmentMetrics(existing.request_fulfillment_metrics) ||
      (await deriveFulfillmentMetrics(contractRow.end_user_department_id));

    const { rows } = await pool.query(
      `UPDATE contract_evaluations
       SET status = $1, evaluation_notes = $2, evaluation_criteria = $3, criterion_code = COALESCE($4, criterion_code), technical_inspection_results = $5, request_fulfillment_metrics = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        status,
        evaluation_notes,
        normalizedCriteria,
        normalizedCriteria.criterionCode,
        normalizedTechnicalResults,
        normalizedFulfillmentMetrics,
        id,
      ]
    );
    res.json(serializeEvaluationRow(rows[0]));
  } catch (err) {
    console.error('❌ Failed to update contract evaluation:', err);
    next(createHttpError(500, 'Failed to update contract evaluation'));
  }
};

const deleteContractEvaluation = async (req, res, next) => {
  const { id } = req.params;

  try {
    await ensureContractEvaluationsTable();

    const { rows } = await pool.query(
      'SELECT evaluator_id FROM contract_evaluations WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Evaluation not found'));
    }

    if (rows[0].evaluator_id !== req.user.id && !canManageContractEvaluations(req)) {
      return next(createHttpError(403, 'You are not authorized to delete this evaluation'));
    }

    await pool.query('DELETE FROM contract_evaluations WHERE id = $1', [id]);

    res.json({ message: 'Evaluation deleted successfully' });
  } catch (err) {
    console.error('❌ Failed to delete contract evaluation:', err);
    next(createHttpError(500, 'Failed to delete contract evaluation'));
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
  deleteContractEvaluation,
  getMyEvaluations,
  getContractEvaluationById,
  getEvaluationCriteria,
};