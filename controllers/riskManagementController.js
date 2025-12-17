const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureRiskRegisterTable = require('../utils/ensureRiskRegisterTable');

const STATUS_OPTIONS = new Set(['open', 'mitigating', 'monitoring', 'closed']);
const LIKELIHOOD_SCORES = {
  rare: 1,
  unlikely: 2,
  possible: 3,
  likely: 4,
  almost_certain: 5,
};

const IMPACT_SCORES = {
  insignificant: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  critical: 5,
};

const parseNumber = value => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizeText = value => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeChoice = (value, options, fallback) => {
  const normalized = sanitizeText(value)?.toLowerCase().replace(/\s+/g, '_');
  if (normalized && options.has(normalized)) {
    return normalized;
  }
  return fallback;
};

const normalizeDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const computeRiskScore = (likelihood, impact) => {
  const likelihoodScore = LIKELIHOOD_SCORES[likelihood] ?? LIKELIHOOD_SCORES.possible;
  const impactScore = IMPACT_SCORES[impact] ?? IMPACT_SCORES.moderate;
  return likelihoodScore * impactScore;
};

const normalizeMedicationRisk = value => {
  if (!value || typeof value !== 'object') return null;

  const itemDescription = sanitizeText(value.item_description || value.itemDescription);
  const criticality = parseNumber(value.criticality);
  const consumptionVariability = parseNumber(value.consumption_variability || value.consumptionVariability);
  const leadTimeRisk = parseNumber(value.lead_time_risk || value.leadTimeRisk);
  const financialExposure = parseNumber(value.financial_exposure || value.financialExposure);
  const expiryRisk = parseNumber(value.expiry_risk || value.expiryRisk);
  const supplierReliability = parseNumber(value.supplier_reliability || value.supplierReliability);

  const hasData =
    itemDescription ||
    criticality !== null ||
    consumptionVariability !== null ||
    leadTimeRisk !== null ||
    financialExposure !== null ||
    expiryRisk !== null ||
    supplierReliability !== null;

  if (!hasData) return null;

  const totalRisk =
    (criticality ?? 0) +
    (consumptionVariability ?? 0) +
    (leadTimeRisk ?? 0) +
    (financialExposure ?? 0) +
    (expiryRisk ?? 0) +
    (supplierReliability ?? 0);

  return {
    item_description: itemDescription,
    criticality,
    consumption_variability: consumptionVariability,
    lead_time_risk: leadTimeRisk,
    financial_exposure: financialExposure,
    expiry_risk: expiryRisk,
    supplier_reliability: supplierReliability,
    total_risk: totalRisk,
  };
};

const buildHighRiskStage = (name, value) => {
  if (!value || typeof value !== 'object') return null;

  const severity = parseNumber(value.severity ?? value.s ?? value.score ?? value.S);
  const rating = parseNumber(value.rating ?? value.r ?? value.R);
  const risk = sanitizeText(value.risk ?? value.Risk);
  const control = sanitizeText(value.control ?? value.Control);

  if (severity === null && rating === null && !risk && !control) {
    return null;
  }

  return { name, severity, rating, risk, control };
};

const normalizeHighRiskItem = value => {
  if (!value || typeof value !== 'object') return null;

  const item = sanitizeText(value.item);
  const controlMeasures = sanitizeText(value.control_measures || value.controlMeasures);
  const initialRiskScore = parseNumber(value.initial_risk_score || value.initialRiskScore);
  const riskLevel = sanitizeText(value.risk_level || value.riskLevel);
  const riskCategory = sanitizeText(value.risk_category || value.riskCategory);
  const highRiskFlag = value.high_risk_flag ?? value.highRiskFlag;

  const stages = [
    buildHighRiskStage('purchasing', value.purchasing),
    buildHighRiskStage('transporting', value.transporting),
    buildHighRiskStage('receiving', value.receiving),
    buildHighRiskStage('storing', value.storing),
    buildHighRiskStage('distribution', value.distribution),
    buildHighRiskStage('shortage', value.shortage),
  ].filter(Boolean);

  const totalRiskFromStages = stages.reduce(
    (sum, stage) => sum + (stage?.severity ?? 0) + (stage?.rating ?? 0),
    0
  );

  const hasData =
    item ||
    controlMeasures ||
    initialRiskScore !== null ||
    riskLevel ||
    riskCategory ||
    stages.length > 0 ||
    typeof highRiskFlag === 'boolean';

  if (!hasData) return null;

  return {
    item,
    stages: stages.length > 0 ? stages : undefined,
    control_measures: controlMeasures,
    initial_risk_score: initialRiskScore,
    risk_level: riskLevel,
    risk_category: riskCategory,
    high_risk_flag: typeof highRiskFlag === 'boolean' ? highRiskFlag : undefined,
    total_risk: parseNumber(value.total_risk) ?? totalRiskFromStages,
  };
};

const supplierScoreToLevel = score => {
  if (!score || score <= 0) return null;
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 6) return 'Medium';
  return 'Low';
};

const normalizeSupplierRisk = value => {
  if (!value || typeof value !== 'object') return null;

  const supplierName = sanitizeText(value.supplier_name || value.supplierName);
  const criticalityLevel = sanitizeText(value.criticality_level || value.criticalityLevel);
  const lastAssessmentDate = normalizeDate(value.last_assessment_date || value.lastAssessmentDate);
  const riskMitigationActions = sanitizeText(value.risk_mitigation_actions || value.riskMitigationActions);

  const risks = [];
  const pushRisk = (key, source) => {
    const likelihood = parseNumber(value[`${key}_likelihood`] ?? source?.likelihood);
    const impact = parseNumber(value[`${key}_impact`] ?? source?.impact);
    if (likelihood === null && impact === null) return;
    const score = (likelihood ?? 0) * (impact ?? 0);
    risks.push({ key, likelihood, impact, score, level: supplierScoreToLevel(score) });
  };

  pushRisk('financial', value.financial);
  pushRisk('operational', value.operational);
  pushRisk('compliance', value.compliance);
  pushRisk('supply_continuity', value.supply_continuity || value.supplyContinuity);

  const hasData =
    supplierName ||
    criticalityLevel ||
    lastAssessmentDate ||
    riskMitigationActions ||
    risks.length > 0;

  if (!hasData) return null;

  const totalScore =
    parseNumber(value.total_score) ?? risks.reduce((sum, risk) => sum + (risk.score ?? 0), 0);

  const riskEntries = risks.reduce((acc, risk) => {
    acc[risk.key] = {
      likelihood: risk.likelihood,
      impact: risk.impact,
      score: risk.score,
      level: risk.level,
    };
    return acc;
  }, {});

  return {
    supplier_name: supplierName,
    criticality_level: criticalityLevel,
    last_assessment_date: lastAssessmentDate,
    risk_mitigation_actions: riskMitigationActions,
    ...riskEntries,
    total_score: totalScore,
  };
};

const canViewRisks = user =>
  Boolean(user?.hasAnyPermission && user.hasAnyPermission(['risks.view', 'risks.manage']));

const canManageRisks = user => Boolean(user?.hasPermission && user.hasPermission('risks.manage'));

const listRisks = async (req, res, next) => {
  try {
    await ensureRiskRegisterTable();

    if (!canViewRisks(req.user)) {
      return next(createHttpError(403, 'Not authorized to view risks'));
    }

    const { rows } = await pool.query(
      `SELECT id, title, category, description, likelihood, impact, risk_score, status, owner, response_plan,
              due_date, medication_risk, high_risk_item, supplier_risk,
              created_by_user_id, updated_by_user_id, created_at, updated_at, closed_at
         FROM risk_register
        ORDER BY risk_score DESC, due_date NULLS LAST, id DESC`
    );

    res.json({ risks: rows });
  } catch (error) {
    console.error('❌ Failed to list risks:', error);
    next(createHttpError(500, 'Failed to load risk register'));
  }
};

const createRisk = async (req, res, next) => {
  try {
    await ensureRiskRegisterTable();

    if (!canManageRisks(req.user)) {
      return next(createHttpError(403, 'Not authorized to create risks'));
    }

    const title = sanitizeText(req.body?.title);
    if (!title) {
      return next(createHttpError(400, 'A risk title is required'));
    }

    const description = sanitizeText(req.body?.description);
    const category = sanitizeText(req.body?.category);
    const owner = sanitizeText(req.body?.owner);
    const responsePlan = sanitizeText(req.body?.response_plan);
    const dueDate = normalizeDate(req.body?.due_date);

    const likelihood = normalizeChoice(req.body?.likelihood, new Set(Object.keys(LIKELIHOOD_SCORES)), 'possible');
    const impact = normalizeChoice(req.body?.impact, new Set(Object.keys(IMPACT_SCORES)), 'moderate');
    const status = normalizeChoice(req.body?.status, STATUS_OPTIONS, 'open');

    const medicationRisk = normalizeMedicationRisk(req.body?.medication_risk);
    const highRiskItem = normalizeHighRiskItem(req.body?.high_risk_item);
    const supplierRisk = normalizeSupplierRisk(req.body?.supplier_risk);

    const riskScore = Math.max(
      computeRiskScore(likelihood, impact),
      medicationRisk?.total_risk ?? 0,
      highRiskItem?.initial_risk_score ?? highRiskItem?.total_risk ?? 0,
      supplierRisk?.total_score ?? 0
    );

    const { rows } = await pool.query(
      `INSERT INTO risk_register (title, category, description, likelihood, impact, risk_score, status, owner, response_plan, due_date, medication_risk, high_risk_item, supplier_risk, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
       RETURNING id, title, category, description, likelihood, impact, risk_score, status, owner, response_plan, due_date, medication_risk, high_risk_item, supplier_risk, created_by_user_id, updated_by_user_id, created_at, updated_at, closed_at`,
      [
        title,
        category,
        description,
        likelihood,
        impact,
        riskScore,
        status,
        owner,
        responsePlan,
        dueDate,
        medicationRisk,
        highRiskItem,
        supplierRisk,
        req.user?.id ?? null,
      ]
    );

    res.status(201).json({ risk: rows[0] });
  } catch (error) {
    console.error('❌ Failed to create risk:', error);
    next(createHttpError(500, 'Failed to create risk'));
  }
};

const updateRisk = async (req, res, next) => {
  const riskId = Number(req.params?.id);
  if (!Number.isInteger(riskId) || riskId <= 0) {
    return next(createHttpError(400, 'Invalid risk reference'));
  }

  try {
    await ensureRiskRegisterTable();

    if (!canManageRisks(req.user)) {
      return next(createHttpError(403, 'Not authorized to update risks'));
    }

    const existing = await pool.query(
      `SELECT id, likelihood, impact, status, closed_at, medication_risk, high_risk_item, supplier_risk
         FROM risk_register WHERE id = $1`,
      [riskId]
    );

    if (existing.rowCount === 0) {
      return next(createHttpError(404, 'Risk not found'));
    }

    const current = existing.rows[0];

    const title = req.body.hasOwnProperty('title') ? sanitizeText(req.body.title) : undefined;
    const category = req.body.hasOwnProperty('category') ? sanitizeText(req.body.category) : undefined;
    const description = req.body.hasOwnProperty('description') ? sanitizeText(req.body.description) : undefined;
    const owner = req.body.hasOwnProperty('owner') ? sanitizeText(req.body.owner) : undefined;
    const responsePlan = req.body.hasOwnProperty('response_plan')
      ? sanitizeText(req.body.response_plan)
      : undefined;
    const dueDate = req.body.hasOwnProperty('due_date') ? normalizeDate(req.body.due_date) : undefined;
    const likelihood = req.body.hasOwnProperty('likelihood')
      ? normalizeChoice(req.body.likelihood, new Set(Object.keys(LIKELIHOOD_SCORES)), current.likelihood)
      : current.likelihood;
    const impact = req.body.hasOwnProperty('impact')
      ? normalizeChoice(req.body.impact, new Set(Object.keys(IMPACT_SCORES)), current.impact)
      : current.impact;
    const status = req.body.hasOwnProperty('status')
      ? normalizeChoice(req.body.status, STATUS_OPTIONS, current.status)
      : current.status;

    const medicationRisk = req.body.hasOwnProperty('medication_risk')
      ? normalizeMedicationRisk(req.body.medication_risk)
      : current.medication_risk;
    const highRiskItem = req.body.hasOwnProperty('high_risk_item')
      ? normalizeHighRiskItem(req.body.high_risk_item)
      : current.high_risk_item;
    const supplierRisk = req.body.hasOwnProperty('supplier_risk')
      ? normalizeSupplierRisk(req.body.supplier_risk)
      : current.supplier_risk;

    const riskScore = Math.max(
      computeRiskScore(likelihood, impact),
      medicationRisk?.total_risk ?? 0,
      highRiskItem?.initial_risk_score ?? highRiskItem?.total_risk ?? 0,
      supplierRisk?.total_score ?? 0
    );

    const updatedFields = [];
    const params = [];

    const pushField = (clause, value) => {
      if (value === undefined) return;
      params.push(value);
      updatedFields.push(`${clause} $${params.length}`);
    };

    pushField('title =', title);
    pushField('category =', category);
    pushField('description =', description);
    pushField('owner =', owner);
    pushField('response_plan =', responsePlan);
    pushField('due_date =', dueDate);
    if (req.body.hasOwnProperty('medication_risk')) {
      pushField('medication_risk =', medicationRisk);
    }
    if (req.body.hasOwnProperty('high_risk_item')) {
      pushField('high_risk_item =', highRiskItem);
    }
    if (req.body.hasOwnProperty('supplier_risk')) {
      pushField('supplier_risk =', supplierRisk);
    }
    pushField('likelihood =', likelihood);
    pushField('impact =', impact);
    pushField('status =', status);

    params.push(riskScore);
    updatedFields.push(`risk_score = $${params.length}`);

    params.push(req.user?.id ?? null);
    updatedFields.push(`updated_by_user_id = $${params.length}`);

    updatedFields.push('updated_at = NOW()');

    if (current.status !== 'closed' && status === 'closed') {
      params.push(new Date().toISOString());
      updatedFields.push(`closed_at = $${params.length}`);
    } else if (status !== 'closed') {
      updatedFields.push('closed_at = NULL');
    }

    if (updatedFields.length === 0) {
      return next(createHttpError(400, 'No risk fields provided to update'));
    }

    params.push(riskId);
    const { rows } = await pool.query(
      `UPDATE risk_register
          SET ${updatedFields.join(', ')}
        WHERE id = $${params.length}
      RETURNING id, title, category, description, likelihood, impact, risk_score, status, owner, response_plan, due_date,
                medication_risk, high_risk_item, supplier_risk,
                created_by_user_id, updated_by_user_id, created_at, updated_at, closed_at`,
      params
    );

    res.json({ risk: rows[0] });
  } catch (error) {
    console.error('❌ Failed to update risk:', error);
    next(createHttpError(500, 'Failed to update risk'));
  }
};

module.exports = {
  listRisks,
  createRisk,
  updateRisk,
};