const express = require('express');
const pool = require('../config/db');
const service = require('../services/procurementEvaluationService');

const router = express.Router();

const EDIT_ROLES = new Set(['admin', 'scm', 'procurementsupervisor', 'procurementspecialist', 'procurementmanager']);
const VIEW_ROLES = new Set([...EDIT_ROLES, 'cmo', 'cfo', 'coo', 'ceo', 'technicalowner', 'bme', 'lab', 'labuser']);
const EVALUATION_TYPES = new Set(['General', 'Laboratory Device', 'Medical Device', 'IT System', 'Service Contract', 'Maintenance Contract', 'Consumables', 'Medication', 'Capital Equipment', 'Construction Project', 'Outsourcing Agreement']);
const STATUSES = new Set(['Draft', 'In Review', 'Finalized', 'Cancelled']);
const CASE_FIELDS = ['title','description','category','request_id','department_id','section_id','evaluation_type','evaluation_period_years','expected_annual_growth_rate','currency','status','recommendation_summary'];
const OFFER_FIELDS = ['supplier_id','supplier_name','offer_name','manufacturer_name','model_name','country_of_origin','pricing_model','is_disqualified','disqualification_reason','compliance_status','lease_monthly_payment','lease_term_months','subscription_base_fee','included_volume','overage_price','sla_penalty_amount','uptime_guarantee_percentage','downtime_cost','supplier_risk_premium','stockout_risk_cost','fx_risk_cost','obsolescence_risk_cost','penalty_or_sla_adjustment','device_price','installation_cost','training_cost','shipping_cost','customs_cost','other_initial_cost','device_discount_value','warranty_years','annual_maintenance_cost','annual_service_contract_cost','annual_fixed_consumables_cost','annual_calibration_qc_cost','annual_spare_parts_cost','expected_lifetime_years','delivery_time_days','payment_terms','minimum_annual_commitment_amount','minimum_annual_commitment_tests','reagent_rental_terms','free_device_included','commitment_penalty_terms','technical_notes','commercial_notes','risk_notes','technical_model','contract_model','package_model','service_model','risk_model','scenario_metadata','is_compliant','disqualification_reason'];
const TEST_FIELDS = ['test_name','test_code','category','unit','expected_monthly_volume','growth_rate','is_required','dependency_risk','is_alternative','notes'];
const COST_FIELDS = ['pricing_method','element_type','quantity','annual_quantity','unit_cost','dependency_group','alternative_group','kit_price','tests_per_kit','usable_tests_per_kit','open_vial_stability_days','onboard_stability_days','shelf_life_months','expected_waste_percentage','repeat_rate_percentage','qc_frequency_per_kit','qc_cost_per_kit','calibrator_frequency_per_kit','calibrator_cost_per_kit','fixed_consumable_cost_per_kit','other_kit_related_cost','price_per_reportable_test','company_absorbs_waste','company_absorbs_qc','company_absorbs_repeats','notes'];
const CRITERIA_FIELDS = ['criteria_name','criteria_group','weight','scoring_type','higher_is_better','is_required','metric_key','normalization_method','target_value','min_value','max_value','is_knockout','required_threshold'];
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
  if (data.compliance_status && !['PENDING','COMPLIANT','NON_COMPLIANT','WAIVED'].includes(data.compliance_status)) badRequest('Invalid compliance_status');
  ['minimum_annual_commitment_amount', 'minimum_annual_commitment_tests', 'lease_monthly_payment', 'lease_term_months', 'subscription_base_fee', 'included_volume', 'overage_price', 'sla_penalty_amount', 'uptime_guarantee_percentage', 'downtime_cost', 'supplier_risk_premium', 'stockout_risk_cost', 'fx_risk_cost', 'obsolescence_risk_cost', 'penalty_or_sla_adjustment'].forEach(field => {
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

router.get('/import/template.csv', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  res.type('text/csv').send('item name,code,category,kit price,tests per kit,shelf life,open-kit stability,onboard stability,monthly volume,reportable price,waste %,repeat %,QC cost,calibrator cost,fixed consumables,notes\n');
}));

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

router.get('/:id/scenarios', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows }); }));
router.post('/:id/scenarios', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, OFFER_FIELDS); validateOfferPayload(payload); if (!payload.supplier_name) badRequest('supplier_name is required'); payload.offer_name = payload.offer_name || req.body.scenario_name || `${payload.supplier_name} - ${payload.pricing_model || 'Scenario'}`; const row = await insertRow('procurement_evaluation_offers', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.scenario.create', userId(req), req.params.id, row); res.status(201).json({ data: row }); }));


router.get('/:id/tests', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT *, expected_monthly_volume * 12 AS expected_annual_volume FROM procurement_evaluation_tests WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows }); }));
router.post('/:id/tests', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, TEST_FIELDS); if (!payload.test_name) badRequest('test_name is required'); const row = await insertRow('procurement_evaluation_tests', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.test.create', userId(req), req.params.id, row); res.status(201).json({ data: row }); }));
router.patch('/:id/tests/:testId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, TEST_FIELDS); const row = await updateRow('procurement_evaluation_tests', 'id', req.params.testId, payload, 'AND evaluation_case_id = $' + (Object.keys(payload).length + 2), [req.params.id]); await audit('procurement_evaluation.test.update', userId(req), req.params.id, row); res.json({ data: row }); }));
router.delete('/:id/tests/:testId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); await pool.query('DELETE FROM procurement_evaluation_tests WHERE id = $1 AND evaluation_case_id = $2', [req.params.testId, req.params.id]); await audit('procurement_evaluation.test.delete', userId(req), req.params.id, { testId: req.params.testId }); res.json({ message: 'Test deleted' }); }));

router.get('/:id/offer-test-costs', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const result = await pool.query(`SELECT c.*, o.offer_name, t.test_name, t.expected_monthly_volume FROM procurement_evaluation_offer_test_costs c JOIN procurement_evaluation_offers o ON o.id = c.offer_id JOIN procurement_evaluation_tests t ON t.id = c.test_id WHERE c.evaluation_case_id = $1 ORDER BY t.id, o.id`, [req.params.id]);
  res.json({ data: result.rows });
}));

router.delete('/:id/offer-test-costs/:offerId/:testId', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const result = await pool.query(
    'DELETE FROM procurement_evaluation_offer_test_costs WHERE evaluation_case_id = $1 AND offer_id = $2 AND test_id = $3 RETURNING *',
    [req.params.id, req.params.offerId, req.params.testId]
  );
  await audit('procurement_evaluation.cost_matrix.clear_item', userId(req), req.params.id, { offerId: req.params.offerId, testId: req.params.testId, deleted: result.rowCount });
  res.json({ message: 'Item details cleared', data: result.rows[0] || null });
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


router.get('/:id/coverage', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const required = (await pool.query('SELECT * FROM procurement_evaluation_tests WHERE evaluation_case_id = $1 AND COALESCE(is_required, true) = true ORDER BY test_name', [req.params.id])).rows;
  const offers = (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows;
  const costs = (await pool.query(`SELECT tc.*, t.test_name, t.test_code FROM procurement_evaluation_offer_test_costs tc JOIN procurement_evaluation_tests t ON t.id = tc.test_id WHERE tc.evaluation_case_id = $1`, [req.params.id])).rows;
  const requiredIds = new Set(required.map(item => Number(item.id)));
  const offeredByTest = new Map();
  costs.forEach(row => { if (!offeredByTest.has(Number(row.test_id))) offeredByTest.set(Number(row.test_id), []); offeredByTest.get(Number(row.test_id)).push(row.offer_id); });
  const byOffer = offers.map(offer => {
    const covered = required.filter(test => costs.some(cost => Number(cost.offer_id) === Number(offer.id) && Number(cost.test_id) === Number(test.id)));
    const missing = required.filter(test => !covered.some(item => Number(item.id) === Number(test.id)));
    const exclusive = costs.filter(cost => Number(cost.offer_id) === Number(offer.id) && (offeredByTest.get(Number(cost.test_id)) || []).length === 1).map(cost => cost.test_name);
    const overlapping = costs.filter(cost => Number(cost.offer_id) === Number(offer.id) && (offeredByTest.get(Number(cost.test_id)) || []).length > 1).map(cost => cost.test_name);
    return { offer_id: offer.id, offer_name: offer.offer_name, supplier_name: offer.supplier_name, required_count: required.length, covered_count: covered.length, coverage_percentage: required.length ? Number(((covered.length / required.length) * 100).toFixed(2)) : 0, missing_items: missing.map(item => item.test_name), exclusive_items: exclusive, overlapping_items: overlapping };
  });
  const unavailable_items = required.filter(test => !offeredByTest.has(Number(test.id))).map(test => test.test_name);
  res.json({ data: { required_items: required, offers: byOffer, unavailable_items } });
}));

router.get('/:id/item-comparison', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const rows = (await pool.query(`SELECT tc.*, o.offer_name, o.supplier_name, t.test_name, t.test_code FROM procurement_evaluation_offer_test_costs tc JOIN procurement_evaluation_offers o ON o.id = tc.offer_id JOIN procurement_evaluation_tests t ON t.id = tc.test_id WHERE tc.evaluation_case_id = $1 AND ${service.FILLED_TEST_COST_SQL} ORDER BY t.test_name, tc.annual_test_cost`, [req.params.id])).rows;
  const byItem = {};
  rows.forEach(row => { byItem[row.test_name] = byItem[row.test_name] || []; byItem[row.test_name].push(row); });
  const data = Object.entries(byItem).map(([test_name, offers]) => {
    const cheapest = offers.filter(o => Number(o.annual_test_cost) > 0).sort((a,b) => Number(a.annual_test_cost)-Number(b.annual_test_cost))[0] || null;
    return { test_name, cheapest_supplier: cheapest, offers, savings_opportunities: offers.map(o => ({ offer_id: o.offer_id, offer_name: o.offer_name, potential_saving: cheapest ? Number((Number(o.annual_test_cost || 0) - Number(cheapest.annual_test_cost || 0)).toFixed(2)) : 0 })).filter(o => o.potential_saving > 0) };
  });
  res.json({ data });
}));

router.post('/:id/import/preview', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const parsed = Array.isArray(req.body?.rows) ? { headers: Object.keys(req.body.rows[0] || {}), rows: req.body.rows } : service.parseDelimitedText(req.body?.text || '');
  const columnMap = req.body?.columnMap || service.autoMapColumns(parsed.headers);
  const validation = service.validateImportRows(parsed.rows, columnMap);
  res.json({ data: { headers: parsed.headers, columnMap, rows: validation, valid_count: validation.filter(row => row.valid).length, error_count: validation.filter(row => !row.valid).length } });
}));

router.post('/:id/offers/:offerId/import', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const option = req.body?.option || 'APPEND';
  if (!['APPEND','REPLACE','UPDATE_MATCHING'].includes(option)) badRequest('Invalid import option');
  const parsed = Array.isArray(req.body?.rows) ? { headers: Object.keys(req.body.rows[0] || {}), rows: req.body.rows } : service.parseDelimitedText(req.body?.text || '');
  const columnMap = req.body?.columnMap || service.autoMapColumns(parsed.headers);
  const validation = service.validateImportRows(parsed.rows, columnMap);
  const invalid = validation.filter(row => !row.valid);
  if (invalid.length) return res.status(400).json({ message: 'Import contains validation errors', errors: invalid });
  const client = await pool.connect();
  const saved = [];
  try {
    await client.query('BEGIN');
    if (option === 'REPLACE') await client.query('DELETE FROM procurement_evaluation_offer_test_costs WHERE evaluation_case_id = $1 AND offer_id = $2', [req.params.id, req.params.offerId]);
    for (const row of validation) {
      const item = row.item;
      let test = (await client.query('SELECT * FROM procurement_evaluation_tests WHERE evaluation_case_id=$1 AND (LOWER(test_name)=LOWER($2) OR test_code=$3) LIMIT 1', [req.params.id, item.test_name, item.test_code || null])).rows[0];
      if (!test) test = (await client.query('INSERT INTO procurement_evaluation_tests (evaluation_case_id,test_name,test_code,category,unit,expected_monthly_volume,is_required,notes) VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING *', [req.params.id, item.test_name, item.test_code || null, item.category || null, item.unit || null, item.expected_monthly_volume || 0, item.notes || null])).rows[0];
      const method = item.pricing_method && service.PRICING_METHODS.has(item.pricing_method) ? item.pricing_method : (item.price_per_reportable_test ? 'PAY_PER_REPORTABLE' : 'KIT_OWNERSHIP');
      const payload = { pricing_method: method, kit_price: item.kit_price || null, tests_per_kit: item.tests_per_kit || null, shelf_life_months: item.shelf_life_months || null, open_vial_stability_days: item.open_vial_stability_days || null, onboard_stability_days: item.onboard_stability_days || null, expected_waste_percentage: item.expected_waste_percentage || 0, repeat_rate_percentage: item.repeat_rate_percentage || 0, qc_cost_per_kit: item.qc_cost_per_kit || 0, calibrator_cost_per_kit: item.calibrator_cost_per_kit || 0, fixed_consumable_cost_per_kit: item.fixed_consumable_cost_per_kit || 0, price_per_reportable_test: item.price_per_reportable_test || null, notes: item.notes || null };
      const calc = method === 'PAY_PER_REPORTABLE' ? service.calculatePayPerReportableCost(payload, Number(test.expected_monthly_volume || 0) * 12) : service.calculateKitOwnershipCost(payload, Number(test.expected_monthly_volume || 0) * 12);
      const data = { ...payload, ...calc, evaluation_case_id: req.params.id, offer_id: req.params.offerId, test_id: test.id };
      const fields = Object.keys(data);
      const result = await client.query(`INSERT INTO procurement_evaluation_offer_test_costs (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (offer_id, test_id) DO UPDATE SET ${fields.filter(f => !['evaluation_case_id','offer_id','test_id'].includes(f)).map(f => `${f}=EXCLUDED.${f}`).join(', ')}, updated_at=CURRENT_TIMESTAMP RETURNING *`, fields.map(f => data[f]));
      saved.push(result.rows[0]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  await audit('procurement_evaluation.import', userId(req), req.params.id, { offerId: req.params.offerId, count: saved.length, option });
  res.json({ data: saved });
}));


router.get('/:id/criteria', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1 ORDER BY id', [req.params.id])).rows, warning: await criteriaWeightWarning(req.params.id) }); }));
router.post('/:id/criteria', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, CRITERIA_FIELDS); if (Number(payload.weight) < 0) badRequest('weight cannot be negative'); const row = await insertRow('procurement_evaluation_criteria', payload, { evaluation_case_id: req.params.id }); await audit('procurement_evaluation.criteria.create', userId(req), req.params.id, row); res.status(201).json({ data: row, warning: await criteriaWeightWarning(req.params.id) }); }));
router.patch('/:id/criteria/:criteriaId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const payload = normalizePayload(req.body, CRITERIA_FIELDS); if (payload.weight !== undefined && Number(payload.weight) < 0) badRequest('weight cannot be negative'); const row = await updateRow('procurement_evaluation_criteria', 'id', req.params.criteriaId, payload, 'AND evaluation_case_id = $' + (Object.keys(payload).length + 2), [req.params.id]); await audit('procurement_evaluation.criteria.update', userId(req), req.params.id, row); res.json({ data: row, warning: await criteriaWeightWarning(req.params.id) }); }));
router.delete('/:id/criteria/:criteriaId', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); await pool.query('DELETE FROM procurement_evaluation_criteria WHERE id = $1 AND evaluation_case_id = $2', [req.params.criteriaId, req.params.id]); await audit('procurement_evaluation.criteria.delete', userId(req), req.params.id, { criteriaId: req.params.criteriaId }); res.json({ message: 'Criteria deleted', warning: await criteriaWeightWarning(req.params.id) }); }));

router.get('/:id/scores', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT * FROM procurement_evaluation_scores WHERE evaluation_case_id = $1 ORDER BY offer_id, criteria_id', [req.params.id])).rows }); }));
router.put('/:id/scores/bulk', asyncHandler(async (req, res) => { forbidUnlessEdit(req); await ensureEditableCase(req.params.id); const rows = Array.isArray(req.body?.items) ? req.body.items : []; const saved = []; for (const item of rows) { const payload = normalizePayload(item, SCORE_FIELDS); const weightResult = await pool.query('SELECT weight FROM procurement_evaluation_criteria WHERE id = $1 AND evaluation_case_id = $2', [item.criteria_id, req.params.id]); if (weightResult.rowCount === 0) badRequest('Invalid criteria_id'); payload.weighted_score = Number(((Number(payload.score || 0) * Number(weightResult.rows[0].weight || 0)) / 100).toFixed(4)); const data = { ...payload, evaluation_case_id: req.params.id, offer_id: item.offer_id, criteria_id: item.criteria_id, evaluator_id: userId(req) }; const fields = Object.keys(data); const result = await pool.query(`INSERT INTO procurement_evaluation_scores (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (offer_id, criteria_id) DO UPDATE SET raw_value=EXCLUDED.raw_value, score=EXCLUDED.score, weighted_score=EXCLUDED.weighted_score, evaluator_id=EXCLUDED.evaluator_id, comments=EXCLUDED.comments, updated_at=CURRENT_TIMESTAMP RETURNING *`, fields.map(f => data[f])); saved.push(result.rows[0]); } await audit('procurement_evaluation.scores.bulk_save', userId(req), req.params.id, { count: saved.length }); res.json({ data: saved }); }));

router.post('/:id/calculate', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req);
  await ensureEditableCase(req.params.id);
  try {
    const data = await service.calculateAllOfferResults(req.params.id);
    await audit('procurement_evaluation.calculate', userId(req), req.params.id, { results: data });
    res.json({ data });
  } catch (error) {
    if (/requires|Invalid pricing_|effective usable tests|no filled item details/i.test(error.message)) {
      badRequest(`Unable to calculate procurement evaluation: ${error.message}`);
    }
    throw error;
  }
}));
router.get('/:id/results', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: (await pool.query('SELECT r.*, o.offer_name, o.supplier_name FROM procurement_evaluation_results r JOIN procurement_evaluation_offers o ON o.id = r.offer_id WHERE r.evaluation_case_id = $1 ORDER BY rank NULLS LAST, final_weighted_score DESC', [req.params.id])).rows }); }));
router.get('/:id/sensitivity', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await service.calculateSensitivityAnalysis(req.params.id) }); }));

router.post('/:id/break-even', asyncHandler(async (req, res) => {
  forbidUnlessView(req);
  const { left, right, max_volume } = req.body || {};
  if (!left || !right) badRequest('left and right scenarios are required');
  const data = service.calculateBreakEven(left, right, max_volume);
  await audit('procurement_evaluation.break_even', userId(req), req.params.id, { left, right, max_volume, data });
  res.json({ data });
}));
router.get('/:id/optimization', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await service.optimizeResults(req.params.id) }); }));
router.get('/:id/recommendation', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await service.generateRecommendationSummary(req.params.id) }); }));

const buildFinalizationReview = async (caseId, selectedOfferId = null) => {
  const warnings = [];
  const weightTotal = Number((await pool.query('SELECT COALESCE(SUM(weight), 0)::numeric AS total FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1', [caseId])).rows[0].total || 0);
  if (weightTotal !== 100) warnings.push(`Criteria weights total ${weightTotal}, not 100.`);
  const requiredCriteriaMissing = (await pool.query(`SELECT c.id, c.criteria_name FROM procurement_evaluation_criteria c WHERE c.evaluation_case_id = $1 AND COALESCE(c.is_required, false) = true AND c.scoring_type = 'manual' AND EXISTS (SELECT 1 FROM procurement_evaluation_offers o WHERE o.evaluation_case_id = c.evaluation_case_id AND COALESCE(o.is_disqualified,false)=false AND NOT EXISTS (SELECT 1 FROM procurement_evaluation_scores s WHERE s.criteria_id=c.id AND s.offer_id=o.id AND s.score IS NOT NULL))`, [caseId])).rows;
  if (requiredCriteriaMissing.length) warnings.push('All required criteria must be scored.');
  const uncovered = (await pool.query(`SELECT t.id, t.test_name FROM procurement_evaluation_tests t WHERE t.evaluation_case_id=$1 AND COALESCE(t.is_required,true)=true AND NOT EXISTS (SELECT 1 FROM procurement_evaluation_offer_test_costs c WHERE c.test_id=t.id)`, [caseId])).rows;
  if (uncovered.length) warnings.push('All required items/tests/services must be covered or waived.');
  let selected = null;
  if (selectedOfferId) {
    selected = (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE id=$1 AND evaluation_case_id=$2', [selectedOfferId, caseId])).rows[0] || null;
    if (!selected) warnings.push('Selected offer does not exist.');
    if (selected?.is_disqualified || selected?.compliance_status === 'NON_COMPLIANT') warnings.push('Selected offer is disqualified or non-compliant.');
    const result = (await pool.query('SELECT * FROM procurement_evaluation_results WHERE offer_id=$1 AND evaluation_case_id=$2', [selectedOfferId, caseId])).rows[0];
    if (result?.knockout_failed || result?.compliance_passed === false) warnings.push('Selected offer failed compliance or knockout checks.');
  }
  return { valid: warnings.length === 0, warnings, weight_total: weightTotal, required_criteria_missing: requiredCriteriaMissing, uncovered_required_items: uncovered, selected_offer: selected };
};

router.get('/:id/compliance-matrix', asyncHandler(async (req, res) => { forbidUnlessView(req); res.json({ data: await buildFinalizationReview(req.params.id) }); }));
router.get('/:id/disqualification-review', asyncHandler(async (req, res) => { forbidUnlessView(req); const rows = (await pool.query(`SELECT o.id AS offer_id, o.offer_name, o.supplier_name, o.is_disqualified, o.disqualification_reason, o.compliance_status, r.knockout_failed, r.compliance_passed, r.recommendation_reason FROM procurement_evaluation_offers o LEFT JOIN procurement_evaluation_results r ON r.offer_id=o.id WHERE o.evaluation_case_id=$1 ORDER BY o.id`, [req.params.id])).rows; res.json({ data: rows }); }));
router.get('/:id/risk-adjusted-tco', asyncHandler(async (req, res) => { forbidUnlessView(req); let rows = (await pool.query(`SELECT r.*, o.offer_name, o.supplier_name FROM procurement_evaluation_results r JOIN procurement_evaluation_offers o ON o.id=r.offer_id WHERE r.evaluation_case_id=$1 ORDER BY r.risk_adjusted_tco NULLS LAST`, [req.params.id])).rows; if (!rows.length) rows = await service.calculateAllOfferResults(req.params.id); res.json({ data: rows }); }));
router.get('/:id/report-summary', asyncHandler(async (req, res) => { forbidUnlessView(req); const [recommendation, review] = await Promise.all([service.generateRecommendationSummary(req.params.id), buildFinalizationReview(req.params.id)]); res.json({ data: { recommendation, finalization_readiness: review } }); }));

router.patch('/:id/finalize', asyncHandler(async (req, res) => {
  forbidUnlessEdit(req); await ensureEditableCase(req.params.id);
  const { selected_offer_id, recommendation_summary } = req.body || {};
  if (!selected_offer_id) badRequest('selected_offer_id is required');
  const review = await buildFinalizationReview(req.params.id, selected_offer_id);
  if (!review.valid) badRequest(`Cannot finalize: ${review.warnings.join(' ')}`);
  const result = await pool.query(`UPDATE procurement_evaluation_cases SET selected_offer_id = $1, recommendation_summary = $2, status = 'Finalized', finalized_by = $3, finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *`, [selected_offer_id, recommendation_summary || null, userId(req), req.params.id]);
  await audit('procurement_evaluation.finalize', userId(req), req.params.id, { selected_offer_id, recommendation_summary });
  res.json({ data: result.rows[0] });
}));


router.patch('/:id/reopen', asyncHandler(async (req, res) => {
  const requesterRole = role(req);
  if (!['admin', 'scm'].includes(requesterRole)) badRequest('Only Admin and SCM may reopen finalized evaluations');
  const result = await pool.query(`UPDATE procurement_evaluation_cases SET status = 'Draft', finalized_by = NULL, finalized_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'Finalized' RETURNING *`, [req.params.id]);
  if (result.rowCount === 0) notFound('Finalized evaluation not found');
  await audit('procurement_evaluation.reopen', userId(req), req.params.id);
  res.json({ data: result.rows[0] });
}));

module.exports = router;