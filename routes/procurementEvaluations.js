const express = require('express');
const pool = require('../config/db');
const service = require('../services/procurementEvaluationService');

const router = express.Router();

const EDIT_ROLES = new Set(['admin', 'scm', 'procurementsupervisor', 'procurementspecialist', 'procurementmanager']);
const VIEW_ROLES = new Set([...EDIT_ROLES, 'cmo', 'cfo', 'coo', 'ceo', 'technicalowner', 'bme', 'lab', 'labuser']);
const EVALUATION_TYPES = new Set(['General', 'Laboratory Device', 'Medical Device', 'IT System', 'Service Contract', 'Maintenance Contract', 'Consumables', 'Medication', 'Capital Equipment']);
const STATUSES = new Set(['Draft', 'In Review', 'Finalized', 'Cancelled']);
const CASE_FIELDS = ['title','description','category','request_id','department_id','section_id','evaluation_type','evaluation_period_years','expected_annual_growth_rate','currency','status','recommendation_summary'];
const OFFER_FIELDS = ['supplier_id','supplier_name','offer_name','manufacturer_name','model_name','country_of_origin','pricing_model','device_price','installation_cost','training_cost','shipping_cost','customs_cost','other_initial_cost','device_discount_value','warranty_years','annual_maintenance_cost','annual_service_contract_cost','annual_fixed_consumables_cost','annual_calibration_qc_cost','annual_spare_parts_cost','expected_lifetime_years','delivery_time_days','payment_terms','minimum_annual_commitment_amount','minimum_annual_commitment_tests','reagent_rental_terms','free_device_included','commitment_penalty_terms','technical_notes','commercial_notes','risk_notes','is_compliant','disqualification_reason'];
const TEST_FIELDS = ['test_name','test_code','category','expected_monthly_volume','growth_rate','is_required','notes'];
const COST_FIELDS = ['pricing_method','kit_price','tests_per_kit','usable_tests_per_kit','open_vial_stability_days','shelf_life_months','expected_waste_percentage','repeat_rate_percentage','qc_frequency_per_kit','qc_cost_per_kit','calibrator_frequency_per_kit','calibrator_cost_per_kit','fixed_consumable_cost_per_kit','other_kit_related_cost','price_per_reportable_test','company_absorbs_waste','company_absorbs_qc','company_absorbs_repeats','notes'];
const CRITERIA_FIELDS = ['criteria_name','criteria_group','weight','scoring_type','higher_is_better','is_required'];
const SCORE_FIELDS = ['raw_value','score','comments'];

const defaultCriteria = [
  ['Total Cost of Ownership', 'Commercial', 35, 'automatic', false, true],
  ['Technical Compliance', 'Technical', 20, 'manual', true, true],
  ['Warranty', 'Commercial', 10, 'automatic', true, false],
  ['Service Support', 'Service', 10, 'manual', true, true],
  ['Consumable Availability', 'Supply', 10, 'manual', true, true],
  ['Delivery Time', 'Logistics', 5, 'automatic', false, false],
  ['Supplier Performance', 'Supplier', 5, 'manual', true, false],
  ['Risk', 'Risk', 5, 'manual', false, false],
];

const role = req => String(req.user?.role || '').toLowerCase();
const canEdit = req => EDIT_ROLES.has(role(req)) || req.user?.hasAnyPermission?.(['procurement.update-status', 'evaluations.manage']);
const canView = req => VIEW_ROLES.has(role(req)) || req.user?.hasAnyPermission?.(['requests.view-all', 'evaluations.manage', 'procurement.update-status']);
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const userId = req => req.user?.id || req.user?.user_id || null;

const forbidUnlessView = req => { if (!canView(req)) { const err = new Error('Not authorized to view procurement evaluations'); err.statusCode = 403; throw err; } };
const forbidUnlessEdit = req => { if (!canEdit(req)) { const err = new Error('Not authorized to edit procurement evaluations'); err.statusCode = 403; throw err; } };
const badRequest = message => { const err = new Error(message); err.statusCode = 400; throw err; };
const notFound = message => { const err = new Error(message); err.statusCode = 404; throw err; };

const audit = async (action, actorId, targetId, details = {}) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (action_type, actor_id, target_type, target_id, details, description)
       VALUES ($1, $2, 'procurement_evaluation', $3, $4, $5)`,
      [action, actorId, targetId, JSON.stringify(details), `${action} procurement evaluation #${targetId}`]
    );
  } catch (_error) {
    try {
      await pool.query(
        `INSERT INTO audit_logs (action, actor_id, target_id, description) VALUES ($1,$2,$3,$4)`,
        [action, actorId, targetId, `${action} procurement evaluation #${targetId}`]
      );
    } catch (error) {
      console.warn('Failed to write procurement evaluation audit log:', error.message);
    }
  }
};

const getCase = async id => {
  const result = await pool.query('SELECT * FROM procurement_evaluation_cases WHERE id = $1', [id]);
  if (result.rowCount === 0) notFound('Procurement evaluation case not found');
  return result.rows[0];
};

const ensureEditableCase = async id => {
  const row = await getCase(id);
  if (row.status === 'Finalized') badRequest('Finalized evaluations are read-only');
  return row;
};

const normalizePayload = (body = {}, allowedFields) => allowedFields.reduce((acc, field) => {
  if (Object.prototype.hasOwnProperty.call(body, field)) {
    acc[field] = body[field] === '' ? null : body[field];
  }
  return acc;
}, {});

const insertRow = async (table, payload, extra = {}) => {
  const data = { ...payload, ...extra };
  const fields = Object.keys(data);
  const placeholders = fields.map((_, index) => `$${index + 1}`);
  const result = await pool.query(
    `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    fields.map(field => data[field])
  );
  return result.rows[0];
};

const updateRow = async (table, idField, id, payload, whereExtra = '', paramsExtra = []) => {
  const fields = Object.keys(payload);
  if (fields.length === 0) badRequest('No fields provided to update');
  const setSql = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
  const result = await pool.query(
    `UPDATE ${table} SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE ${idField} = $${fields.length + 1} ${whereExtra} RETURNING *`,
    [...fields.map(field => payload[field]), id, ...paramsExtra]
  );
  if (result.rowCount === 0) notFound('Record not found');
  return result.rows[0];
};

const validateCasePayload = data => {
  if (data.evaluation_type && !EVALUATION_TYPES.has(data.evaluation_type)) badRequest('Invalid evaluation_type');
  if (data.status && !STATUSES.has(data.status)) badRequest('Invalid status');
  if (data.evaluation_period_years !== undefined && Number(data.evaluation_period_years) <= 0) badRequest('evaluation_period_years must be positive');
};
const validateOfferPayload = data => {
  if (data.pricing_model && !service.PRICING_MODELS.has(data.pricing_model)) badRequest('Invalid pricing_model');
  ['minimum_annual_commitment_amount', 'minimum_annual_commitment_tests'].forEach(field => {
    if (data[field] !== undefined && Number(data[field]) < 0) badRequest(`${field} cannot be negative`);
  });
};
const validateCostPayload = data => {
  const method = data.pricing_method || 'KIT_OWNERSHIP';
  if (!service.PRICING_METHODS.has(method)) badRequest('Invalid pricing_method');
  if (method === 'KIT_OWNERSHIP' && Number(data.kit_price || 0) <= 0) badRequest('KIT_OWNERSHIP requires kit_price > 0');
  if (method === 'KIT_OWNERSHIP' && Number(data.tests_per_kit || 0) <= 0 && Number(data.usable_tests_per_kit || 0) <= 0) badRequest('KIT_OWNERSHIP requires tests_per_kit > 0 unless usable_tests_per_kit is provided');
  if (method === 'PAY_PER_REPORTABLE' && Number(data.price_per_reportable_test || 0) <= 0) badRequest('PAY_PER_REPORTABLE requires price_per_reportable_test > 0');
  ['expected_waste_percentage', 'repeat_rate_percentage'].forEach(field => {
    if (data[field] !== undefined) data[field] = service.normalizePercent(data[field]);
  });
};

const seedDefaultCriteria = async caseId => {
  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1', [caseId]);
  if (existing.rows[0].count > 0) return;
  for (const [criteria_name, criteria_group, weight, scoring_type, higher_is_better, is_required] of defaultCriteria) {
    await pool.query(
      `INSERT INTO procurement_evaluation_criteria (evaluation_case_id, criteria_name, criteria_group, weight, scoring_type, higher_is_better, is_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [caseId, criteria_name, criteria_group, weight, scoring_type, higher_is_better, is_required]
    );
  }
};

const criteriaWeightWarning = async caseId => {
  const result = await pool.query('SELECT COALESCE(SUM(weight), 0)::numeric AS total FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1', [caseId]);
  const total = Number(result.rows[0].total || 0);
  return total === 100 ? null : `Criteria weights total ${total}, not 100.`;
};

router.get('/', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const result = await pool.query(
    `SELECT c.*, d.name AS department_name, u.name AS created_by_name, so.offer_name AS selected_offer_name,
            best.tco_period_cost AS best_tco, best.final_weighted_score AS best_score
       FROM procurement_evaluation_cases c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN procurement_evaluation_offers so ON so.id = c.selected_offer_id
       LEFT JOIN LATERAL (
         SELECT tco_period_cost, final_weighted_score FROM procurement_evaluation_results r
          WHERE r.evaluation_case_id = c.id ORDER BY rank NULLS LAST, final_weighted_score DESC LIMIT 1
       ) best ON TRUE
      ORDER BY c.created_at DESC`
  );
  res.json({ data: result.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req);
  const payload = normalizePayload(req.body, CASE_FIELDS);
  validateCasePayload(payload);
  if (!payload.title || !payload.category) badRequest('title and category are required');
  const row = await insertRow('procurement_evaluation_cases', payload, { created_by: userId(req) });
  if (row.evaluation_type === 'Laboratory Device') await seedDefaultCriteria(row.id);
  await audit('procurement_evaluation.create', userId(req), row.id, payload);
  res.status(201).json({ data: row, warning: await criteriaWeightWarning(row.id) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const row = await getCase(req.params.id);
  res.json({ data: row, warning: await criteriaWeightWarning(req.params.id) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req);
  await ensureEditableCase(req.params.id);
  const payload = normalizePayload(req.body, CASE_FIELDS);
  validateCasePayload(payload);
  const row = await updateRow('procurement_evaluation_cases', 'id', req.params.id, payload);
  await audit('procurement_evaluation.update', userId(req), req.params.id, payload);
  res.json({ data: row, warning: await criteriaWeightWarning(req.params.id) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req);
  await ensureEditableCase(req.params.id);
  await pool.query('DELETE FROM procurement_evaluation_cases WHERE id = $1', [req.params.id]);
  await audit('procurement_evaluation.delete', userId(req), req.params.id);
  res.json({ message: 'Procurement evaluation deleted' });
}));

router.get('/:id/offers', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows }); }));
router.post('/:id/offers', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, OFFER_FIELDS); validateOfferPayload(payload); if (!payload.supplier_name || !payload.offer_name) badRequest('supplier_name and offer_name are required'); const row = await insertRow('procurement_evaluation_offers', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.offer.create', userId(req), req.params.id, row); res.status(201).json({ data: row }); }));
router.patch('/:id/offers/:offerId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, OFFER_FIELDS); validateOfferPayload(payload); const row = await updateRow('procurement_evaluation_offers', 'id', req.params.offerId, payload, 'AND evaluation_case_id = $' + (Object.keys(payload).length + 2), [req.params.id]); await audit('procurement_evaluation.offer.update', userId(req), req.params.id, row); res.json({ data: row }); }));
router.delete('/:id/offers/:offerId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); await pool.query('DELETE FROM procurement_evaluation_offers WHERE id = $1 AND evaluation_case_id = $2', [req.params.offerId, req.params.id]); await audit('procurement_evaluation.offer.delete', userId(req), req.params.id, { offerId: req.params.offerId }); res.json({ message: 'Offer deleted' }); }));

router.get('/:id/tests', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT *, expected_monthly_volume * 12 AS expected_annual_volume FROM procurement_evaluation_tests WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows }); }));
router.post('/:id/tests', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, TEST_FIELDS); if (!payload.test_name) badRequest('test_name is required'); const row = await insertRow('procurement_evaluation_tests', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.test.create', userId(req), req.params.id, row); res.status(201).json({ data: row }); }));
router.patch('/:id/tests/:testId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, TEST_FIELDS); const row = await updateRow('procurement_evaluation_tests', 'id', req.params.testId, payload, 'AND evaluation_case_id = $' + (Object.keys(payload).length + 2), [req.params.id]); await audit('procurement_evaluation.test.update', userId(req), req.params.id, row); res.json({ data: row }); }));
router.delete('/:id/tests/:testId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); await pool.query('DELETE FROM procurement_evaluation_tests WHERE id = $1 AND evaluation_case_id = $2', [req.params.testId, req.params.id]); await audit('procurement_evaluation.test.delete', userId(req), req.params.id, { testId: req.params.testId }); res.json({ message: 'Test deleted' }); }));

router.get('/:id/offer-test-costs', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const result = await pool.query(`SELECT c.*, o.offer_name, t.test_name, t.expected_monthly_volume FROM procurement_evaluation_offer_test_costs c JOIN procurement_evaluation_offers o ON o.id = c.offer_id JOIN procurement_evaluation_tests t ON t.id = c.test_id WHERE c.evaluation_case_id = $1 ORDER BY t.id, o.id`, [req.params.id]);
  res.json({ data: result.rows });
}));

router.put('/:id/offer-test-costs/bulk', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  const saved = [];
  for (const item of rows) {
    const payload = normalizePayload(item, COST_FIELDS);
    validateCostPayload(payload);
    const annualVolume = Number(item.expected_monthly_volume || 0) * 12;
    const calc = payload.pricing_method === 'PAY_PER_REPORTABLE' ? service.calculatePayPerReportableCost(payload, annualVolume) : service.calculateKitOwnershipCost(payload, annualVolume);
    const data = { ...payload, ...calc, evaluation_case_id: req.params.id, offer_id: item.offer_id, test_id: item.test_id };
    const fields = Object.keys(data);
    const result = await pool.query(
      `INSERT INTO procurement_evaluation_offer_test_costs (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})
       ON CONFLICT (offer_id, test_id) DO UPDATE SET ${fields.filter(f => !['evaluation_case_id','offer_id','test_id'].includes(f)).map((f, i) => `${f} = EXCLUDED.${f}`).join(', ')}, updated_at = CURRENT_TIMESTAMP RETURNING *`,
      fields.map(f => data[f])
    );
    saved.push(result.rows[0]);
  }
  await audit('procurement_evaluation.cost_matrix.bulk_save', userId(req), req.params.id, { count: saved.length });
  res.json({ data: saved });
}));

router.get('/:id/criteria', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows, warning: await criteriaWeightWarning(req.params.id) }); }));
router.post('/:id/criteria', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, CRITERIA_FIELDS); if (Number(payload.weight) < 0) badRequest('weight cannot be negative'); const row = await insertRow('procurement_evaluation_criteria', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.criteria.create', userId(req), req.params.id, row); res.status(201).json({ data: row, warning: await criteriaWeightWarning(req.params.id) }); }));
router.patch('/:id/criteria/:criteriaId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, CRITERIA_FIELDS); if (payload.weight !== undefined && Number(payload.weight) < 0) badRequest('weight cannot be negative'); const row = await updateRow('procurement_evaluation_criteria', 'id', req.params.criteriaId, payload, 'AND evaluation_case_id = $' + (Object.keys(payload).length + 2), [req.params.id]); await audit('procurement_evaluation.criteria.update', userId(req), req.params.id, row); res.json({ data: row, warning: await criteriaWeightWarning(req.params.id) }); }));
router.delete('/:id/criteria/:criteriaId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); await pool.query('DELETE FROM procurement_evaluation_criteria WHERE id = $1 AND evaluation_case_id = $2', [req.params.criteriaId, req.params.id]); await audit('procurement_evaluation.criteria.delete', userId(req), req.params.id, { criteriaId: req.params.criteriaId }); res.json({ message: 'Criteria deleted', warning: await criteriaWeightWarning(req.params.id) }); }));

router.get('/:id/scores', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_scores WHERE evaluation_case_id = $1 ORDER BY offer_id, criteria_id', [req.params.id])).rows }); }));
router.put('/:id/scores/bulk', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const rows = Array.isArray(req.body?.items) ? req.body.items : []; const saved = []; for (const item of rows) { const payload = normalizePayload(item, SCORE_FIELDS); const weightResult = await pool.query('SELECT weight FROM procurement_evaluation_criteria WHERE id = $1 AND evaluation_case_id = $2', [item.criteria_id, req.params.id]); if (weightResult.rowCount === 0) badRequest('Invalid criteria_id'); payload.weighted_score = Number(((Number(payload.score || 0) * Number(weightResult.rows[0].weight || 0)) / 100).toFixed(4)); const data = { ...payload, evaluation_case_id: req.params.id, offer_id: item.offer_id, criteria_id: item.criteria_id, evaluator_id: userId(req) }; const fields = Object.keys(data); const result = await pool.query(`INSERT INTO procurement_evaluation_scores (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (offer_id, criteria_id) DO UPDATE SET raw_value=EXCLUDED.raw_value, score=EXCLUDED.score, weighted_score=EXCLUDED.weighted_score, evaluator_id=EXCLUDED.evaluator_id, comments=EXCLUDED.comments, updated_at=CURRENT_TIMESTAMP RETURNING *`, fields.map(f => data[f])); saved.push(result.rows[0]); } await audit('procurement_evaluation.scores.bulk_save', userId(req), req.params.id, { count: saved.length }); res.json({ data: saved }); }));

router.post('/:id/calculate', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const data = await service.calculateAllOfferResults(req.params.id); await audit('procurement_evaluation.calculate', userId(req), req.params.id, { results: data }); res.json({ data }); }));
router.get('/:id/results', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT r.*, o.offer_name, o.supplier_name FROM procurement_evaluation_results r JOIN procurement_evaluation_offers o ON o.id = r.offer_id WHERE r.evaluation_case_id = $1 ORDER BY rank NULLS LAST, final_weighted_score DESC', [req.params.id])).rows }); }));
router.get('/:id/sensitivity', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await service.calculateSensitivityAnalysis(req.params.id) }); }));
router.get('/:id/recommendation', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await service.generateRecommendationSummary(req.params.id) }); }));

router.patch('/:id/finalize', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const { selected_offer_id, recommendation_summary } = req.body || {};
  if (!selected_offer_id) badRequest('selected_offer_id is required');
  const result = await pool.query(`UPDATE procurement_evaluation_cases SET selected_offer_id = $1, recommendation_summary = $2, status = 'Finalized', finalized_by = $3, finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *`, [selected_offer_id, recommendation_summary || null, userId(req), req.params.id]);
  await audit('procurement_evaluation.finalize', userId(req), req.params.id, { selected_offer_id, recommendation_summary });
  res.json({ data: result.rows[0] });
}));

module.exports = router;