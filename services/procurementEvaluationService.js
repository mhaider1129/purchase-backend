const pool = require('../config/db');

const COMMERCIAL_MODELS = ['PURCHASE', 'LEASE', 'REAGENT_RENTAL', 'PAY_PER_REPORTABLE', 'KIT_OWNERSHIP', 'HYBRID', 'SUBSCRIPTION', 'OUTSOURCING', 'SERVICE_CONTRACT', 'CUSTOM'];
const PRICING_METHODS = new Set(COMMERCIAL_MODELS);
const PRICING_MODELS = new Set(COMMERCIAL_MODELS);

const toNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = value => Number(toNumber(value).toFixed(2));
const score = value => Number(Math.max(0, Math.min(100, toNumber(value))).toFixed(4));

const normalizePercent = value => {
  const numeric = toNumber(value);
  if (numeric > 1) return numeric / 100;
  if (numeric < 0) return 0;
  return numeric;
};

const calculateInitialCost = offer => money(
  toNumber(offer.device_price) +
  toNumber(offer.installation_cost) +
  toNumber(offer.training_cost) +
  toNumber(offer.shipping_cost) +
  toNumber(offer.customs_cost) +
  toNumber(offer.other_initial_cost) -
  toNumber(offer.device_discount_value)
);

const calculateAnnualFixedCost = offer => money(
  toNumber(offer.annual_maintenance_cost) +
  toNumber(offer.annual_service_contract_cost) +
  toNumber(offer.annual_fixed_consumables_cost) +
  toNumber(offer.annual_calibration_qc_cost) +
  toNumber(offer.annual_spare_parts_cost)
);

const calculateKitOwnershipCost = (testCost, annualVolume) => {
  const kitPrice = toNumber(testCost.kit_price);
  const testsPerKit = toNumber(testCost.tests_per_kit);
  const usableTests = toNumber(testCost.usable_tests_per_kit);
  if (kitPrice <= 0) throw new Error('KIT_OWNERSHIP requires kit_price > 0');
  if (testsPerKit <= 0 && usableTests <= 0) throw new Error('KIT_OWNERSHIP requires tests_per_kit > 0 unless usable_tests_per_kit is provided');

  const totalKitCost =
    kitPrice +
    toNumber(testCost.qc_cost_per_kit) +
    toNumber(testCost.calibrator_cost_per_kit) +
    toNumber(testCost.fixed_consumable_cost_per_kit) +
    toNumber(testCost.other_kit_related_cost);
  const effectiveUsableTests = usableTests > 0
    ? usableTests
    : testsPerKit * (1 - normalizePercent(testCost.expected_waste_percentage)) * (1 - normalizePercent(testCost.repeat_rate_percentage));
  if (effectiveUsableTests <= 0) throw new Error('KIT_OWNERSHIP effective usable tests must be greater than 0');
  const effectiveCost = totalKitCost / effectiveUsableTests;
  return {
    calculated_effective_cost_per_reported_test: Number(effectiveCost.toFixed(4)),
    annual_test_cost: money(toNumber(annualVolume) * effectiveCost),
  };
};

const calculatePayPerReportableCost = (testCost, annualVolume) => {
  const pricePerReported = toNumber(testCost.price_per_reportable_test);
  if (pricePerReported <= 0) throw new Error('PAY_PER_REPORTABLE requires price_per_reportable_test > 0');
  return {
    calculated_effective_cost_per_reported_test: Number(pricePerReported.toFixed(4)),
    annual_test_cost: money(toNumber(annualVolume) * pricePerReported),
  };
};


const calculateRecurringElementCost = (element, annualVolume) => {
  const method = element.pricing_method || 'PURCHASE';
  if (!PRICING_METHODS.has(method)) throw new Error(`Invalid pricing_method: ${method}`);
  if (method === 'PAY_PER_REPORTABLE') return calculatePayPerReportableCost(element, annualVolume);
  if (method === 'KIT_OWNERSHIP' || method === 'REAGENT_RENTAL' || method === 'HYBRID') return calculateKitOwnershipCost(element, annualVolume);

  const annualQuantity = Math.max(1, toNumber(element.annual_quantity || element.quantity || 1));
  const unitCost = toNumber(element.unit_cost || element.kit_price || element.price_per_reportable_test);
  const recurringCost = money(annualQuantity * unitCost);
  return {
    calculated_effective_cost_per_reported_test: annualVolume > 0 ? Number((recurringCost / annualVolume).toFixed(4)) : 0,
    annual_test_cost: recurringCost,
  };
};

const calculateOfferAnnualVariableCost = async (caseId, offerId, options = {}) => {
  const { rows } = await pool.query(
    `SELECT tc.*, t.expected_monthly_volume, COALESCE(t.growth_rate, c.expected_annual_growth_rate, 0) AS growth_rate
       FROM procurement_evaluation_offer_test_costs tc
       JOIN procurement_evaluation_tests t ON t.id = tc.test_id
       JOIN procurement_evaluation_cases c ON c.id = tc.evaluation_case_id
      WHERE tc.evaluation_case_id = $1 AND tc.offer_id = $2`,
    [caseId, offerId]
  );

  const volumeMultiplier = toNumber(options.volumeMultiplier) || 1;
  let annualVariableCost = 0;
  let totalExpectedReportedTests = 0;
  const tests = [];

  for (const row of rows) {
    const method = row.pricing_method || 'KIT_OWNERSHIP';
    if (!PRICING_METHODS.has(method)) throw new Error(`Invalid pricing_method: ${method}`);
    const annualVolume = toNumber(row.expected_monthly_volume) * 12 * volumeMultiplier;
    const practical = calculatePracticalUtilization(row, toNumber(row.expected_monthly_volume) * volumeMultiplier);
    const adjustedRow = {
      ...row,
      kit_price: toNumber(row.kit_price) * (options.reagentPriceMultiplier || 1),
      unit_cost: toNumber(row.unit_cost) * (options.reagentPriceMultiplier || 1),
      expected_waste_percentage: normalizePercent(row.expected_waste_percentage) * (options.wastageMultiplier || 1),
      price_per_reportable_test: toNumber(row.price_per_reportable_test) * (options.payPerReportableMultiplier || 1),
    };
    const calculation = calculateRecurringElementCost(adjustedRow, annualVolume);
    annualVariableCost += calculation.annual_test_cost;
    totalExpectedReportedTests += annualVolume;
    tests.push({ ...row, ...practical, ...calculation, annual_volume: annualVolume });
  }

  return {
    annual_variable_test_cost: money(annualVariableCost),
    total_expected_reported_tests: money(totalExpectedReportedTests),
    tests,
  };
};

const getCaseAndOffer = async (caseId, offerId) => {
  const caseResult = await pool.query('SELECT * FROM procurement_evaluation_cases WHERE id = $1', [caseId]);
  const offerResult = await pool.query('SELECT * FROM procurement_evaluation_offers WHERE id = $1 AND evaluation_case_id = $2', [offerId, caseId]);
  if (caseResult.rowCount === 0) throw new Error('Evaluation case not found');
  if (offerResult.rowCount === 0) throw new Error('Evaluation offer not found');
  return { evaluationCase: caseResult.rows[0], offer: offerResult.rows[0] };
};

const calculateOfferTco = async (caseId, offerId, options = {}) => {
  const { evaluationCase, offer } = await getCaseAndOffer(caseId, offerId);
  if (!PRICING_MODELS.has(offer.pricing_model)) throw new Error(`Invalid pricing_model: ${offer.pricing_model}`);

  const initialCost = calculateInitialCost({
    ...offer,
    shipping_cost: toNumber(offer.shipping_cost) * (options.exchangeRateMultiplier || 1),
    customs_cost: toNumber(offer.customs_cost) * (options.exchangeRateMultiplier || 1),
  });
  const annualFixedCost = calculateAnnualFixedCost(offer);
  const variable = await calculateOfferAnnualVariableCost(caseId, offerId, options);
  const periodYears = Math.max(1, Math.trunc(toNumber(evaluationCase.evaluation_period_years) || 5));
  const growthRate = normalizePercent(options.growthRateOverride ?? evaluationCase.expected_annual_growth_rate);
  const baseAnnualCommercialCost = annualFixedCost + variable.annual_variable_test_cost;

  let annualCommitmentAdjustment = 0;
  let commitmentVolumeShortfall = false;
  let shortfallTests = 0;
  let commitmentWarning = null;
  let firstYearAnnualCost = baseAnnualCommercialCost;
  if (offer.pricing_model === 'REAGENT_RENTAL') {
    const minimumAmount = toNumber(offer.minimum_annual_commitment_amount);
    if (baseAnnualCommercialCost < minimumAmount) {
      annualCommitmentAdjustment = money(minimumAmount - baseAnnualCommercialCost);
      firstYearAnnualCost = minimumAmount;
    }
    const minimumTests = toNumber(offer.minimum_annual_commitment_tests);
    if (minimumTests > 0 && variable.total_expected_reported_tests < minimumTests) {
      commitmentVolumeShortfall = true;
      shortfallTests = money(minimumTests - variable.total_expected_reported_tests);
    }
    if (annualCommitmentAdjustment > 0 || commitmentVolumeShortfall) {
      commitmentWarning = `Reagent rental commitment risk: ${annualCommitmentAdjustment > 0 ? `amount shortfall ${annualCommitmentAdjustment}` : 'amount commitment met'}; ${commitmentVolumeShortfall ? `volume shortfall ${shortfallTests} tests` : 'volume commitment met'}.`;
    }
  }

  let recurringTco = 0;
  for (let year = 0; year < periodYears; year += 1) {
    const yearCost = baseAnnualCommercialCost * Math.pow(1 + growthRate, year);
    if (offer.pricing_model === 'REAGENT_RENTAL') {
      recurringTco += Math.max(yearCost, toNumber(offer.minimum_annual_commitment_amount));
    } else {
      recurringTco += yearCost;
    }
  }

  const totalExpectedTestsOverPeriod = variable.total_expected_reported_tests * Array.from({ length: periodYears }).reduce((sum, _, index) => sum + Math.pow(1 + growthRate, index), 0);
  const tco = money(initialCost + recurringTco);
  return {
    evaluation_case_id: Number(caseId),
    offer_id: Number(offerId),
    pricing_model: offer.pricing_model,
    initial_cost: initialCost,
    annual_fixed_cost: annualFixedCost,
    annual_variable_test_cost: variable.annual_variable_test_cost,
    annual_commitment_adjustment: annualCommitmentAdjustment,
    total_annual_cost: money(firstYearAnnualCost),
    tco_period_cost: tco,
    average_cost_per_reported_test: totalExpectedTestsOverPeriod > 0 ? Number((tco / totalExpectedTestsOverPeriod).toFixed(4)) : 0,
    total_expected_reported_tests: money(totalExpectedTestsOverPeriod),
    commitment_volume_shortfall: commitmentVolumeShortfall,
    shortfall_tests: shortfallTests,
    commitment_warning: commitmentWarning,
    tests: variable.tests,
  };
};

const calculateCriteriaScores = async (caseId, calculatedRows) => {
  const criteria = (await pool.query('SELECT * FROM procurement_evaluation_criteria WHERE evaluation_case_id = $1', [caseId])).rows;
  const manualScores = (await pool.query('SELECT * FROM procurement_evaluation_scores WHERE evaluation_case_id = $1', [caseId])).rows;
  const lowestTco = Math.min(...calculatedRows.map(row => toNumber(row.tco_period_cost)).filter(value => value > 0));
  const fastestDelivery = Math.min(...calculatedRows.map(row => toNumber(row.offer.delivery_time_days)).filter(value => value > 0));
  const highestWarranty = Math.max(...calculatedRows.map(row => toNumber(row.offer.warranty_years)));

  return calculatedRows.map(row => {
    let weightedSum = 0;
    let totalWeight = 0;
    const breakdown = {};
    for (const criterion of criteria) {
      const weight = toNumber(criterion.weight);
      const name = String(criterion.criteria_name || '').toLowerCase();
      let normalizedScore = null;
      if (criterion.scoring_type === 'automatic' && name.includes('cost')) normalizedScore = lowestTco > 0 ? (lowestTco / toNumber(row.tco_period_cost)) * 100 : 0;
      else if (criterion.scoring_type === 'automatic' && name.includes('delivery')) normalizedScore = fastestDelivery > 0 && toNumber(row.offer.delivery_time_days) > 0 ? (fastestDelivery / toNumber(row.offer.delivery_time_days)) * 100 : 0;
      else if (criterion.scoring_type === 'automatic' && name.includes('warranty')) normalizedScore = highestWarranty > 0 ? (toNumber(row.offer.warranty_years) / highestWarranty) * 100 : 0;
      else {
        const manual = manualScores.find(item => Number(item.offer_id) === Number(row.offer_id) && Number(item.criteria_id) === Number(criterion.id));
        normalizedScore = manual ? toNumber(manual.score) : 0;
      }
      normalizedScore = score(normalizedScore);
      breakdown[name] = normalizedScore;
      weightedSum += weight * normalizedScore;
      totalWeight += weight;
    }
    return {
      ...row,
      cost_score: lowestTco > 0 ? score((lowestTco / toNumber(row.tco_period_cost)) * 100) : 0,
      technical_score: breakdown['technical compliance'] || 0,
      supplier_score: breakdown['supplier performance'] || 0,
      risk_score: breakdown.risk || 0,
      final_weighted_score: totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(4)) : 0,
    };
  });
};

const calculateAllOfferResults = async caseId => {
  const offers = (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id = $1 ORDER BY id', [caseId])).rows;
  const calculatedRows = [];
  for (const offer of offers) {
    calculatedRows.push({ ...(await calculateOfferTco(caseId, offer.id)), offer });
  }
  const scored = await calculateCriteriaScores(caseId, calculatedRows);
  scored.sort((a, b) => toNumber(b.final_weighted_score) - toNumber(a.final_weighted_score) || toNumber(a.tco_period_cost) - toNumber(b.tco_period_cost));

  await pool.query('DELETE FROM procurement_evaluation_results WHERE evaluation_case_id = $1', [caseId]);
  for (let index = 0; index < scored.length; index += 1) {
    const row = scored[index];
    row.rank = index + 1;
    await pool.query(
      `INSERT INTO procurement_evaluation_results
       (evaluation_case_id, offer_id, pricing_model, initial_cost, annual_fixed_cost, annual_variable_test_cost, annual_commitment_adjustment, total_annual_cost, tco_period_cost, average_cost_per_reported_test, total_expected_reported_tests, cost_score, technical_score, supplier_score, risk_score, final_weighted_score, commitment_volume_shortfall, shortfall_tests, commitment_warning, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [caseId, row.offer_id, row.pricing_model, row.initial_cost, row.annual_fixed_cost, row.annual_variable_test_cost, row.annual_commitment_adjustment, row.total_annual_cost, row.tco_period_cost, row.average_cost_per_reported_test, row.total_expected_reported_tests, row.cost_score, row.technical_score, row.supplier_score, row.risk_score, row.final_weighted_score, row.commitment_volume_shortfall, row.shortfall_tests, row.commitment_warning, row.rank]
    );
  }
  return scored.map(({ offer, tests, ...row }) => row);
};

const rankOffers = async caseId => (await calculateAllOfferResults(caseId)).sort((a, b) => a.rank - b.rank);

const calculateCostPerReportedTest = async (caseId, offerId) => {
  const result = await calculateOfferTco(caseId, offerId);
  return result.average_cost_per_reported_test;
};

const calculateSensitivityAnalysis = async caseId => {
  const offers = (await pool.query('SELECT * FROM procurement_evaluation_offers WHERE evaluation_case_id = $1 ORDER BY id', [caseId])).rows;
  const scenarios = [
    { key: 'base', label: 'Base volume', options: {} },
    { key: 'low_volume', label: 'Low volume -20%', options: { volumeMultiplier: 0.8 } },
    { key: 'high_volume', label: 'High volume +20%', options: { volumeMultiplier: 1.2 } },
    { key: 'growth_plus_10', label: 'Annual growth +10%', options: { growthRateOverride: 0.1 } },
    { key: 'reagent_price_plus_10', label: 'Reagent price increase +10%', options: { reagentPriceMultiplier: 1.1 } },
    { key: 'wastage_plus_10', label: 'Wastage increase +10%', options: { wastageMultiplier: 1.1 } },
    { key: 'pay_per_reportable_plus_10', label: 'Pay-per-reportable price increase +10%', options: { payPerReportableMultiplier: 1.1 } },
    { key: 'exchange_customs_plus_10', label: 'Exchange rate/customs increase +10%', options: { exchangeRateMultiplier: 1.1 } },
  ];
  const output = [];
  for (const scenario of scenarios) {
    const rows = [];
    for (const offer of offers) rows.push({ offer_id: offer.id, offer_name: offer.offer_name, ...(await calculateOfferTco(caseId, offer.id, scenario.options)) });
    rows.sort((a, b) => a.tco_period_cost - b.tco_period_cost);
    output.push({ ...scenario, winner: rows[0] || null, offers: rows });
  }
  const baseWinner = output[0]?.winner?.offer_id;
  return output.map(item => ({ ...item, recommendation_changes: baseWinner && item.winner?.offer_id !== baseWinner }));
};


const calculateBreakEven = (left, right, maxVolume = 250000) => {
  const step = Math.max(1, Math.ceil(maxVolume / 500));
  let previous = null;
  for (let volume = step; volume <= maxVolume; volume += step) {
    const leftCost = toNumber(left.initial_cost) + toNumber(left.fixed_annual_cost) + toNumber(left.variable_cost_per_unit) * volume;
    const rightCost = toNumber(right.initial_cost) + toNumber(right.fixed_annual_cost) + toNumber(right.variable_cost_per_unit) * volume;
    const diff = leftCost - rightCost;
    if (previous && Math.sign(previous.diff) !== Math.sign(diff)) {
      return { break_even_volume: volume, left_cost: money(leftCost), right_cost: money(rightCost), cheaper_below: previous.diff < 0 ? left.name : right.name, cheaper_above: diff < 0 ? left.name : right.name };
    }
    previous = { volume, diff };
  }
  return { break_even_volume: null, message: 'No break-even point found in the evaluated range.' };
};

const optimizeResults = async caseId => {
  let results = (await pool.query(
    `SELECT r.*, o.offer_name, o.supplier_name, o.risk_notes
       FROM procurement_evaluation_results r
       JOIN procurement_evaluation_offers o ON o.id = r.offer_id
      WHERE r.evaluation_case_id = $1`,
    [caseId]
  )).rows;
  if (results.length === 0) results = await calculateAllOfferResults(caseId);
  const byLowest = field => [...results].filter(row => toNumber(row[field]) > 0).sort((a, b) => toNumber(a[field]) - toNumber(b[field]))[0] || null;
  const byHighest = field => [...results].sort((a, b) => toNumber(b[field]) - toNumber(a[field]))[0] || null;
  return {
    best_financial_scenario: byLowest('total_annual_cost'),
    best_tco: byLowest('tco_period_cost'),
    lowest_cost_per_unit: byLowest('average_cost_per_reported_test'),
    best_technical_scenario: byHighest('technical_score'),
    best_overall_scenario: byHighest('final_weighted_score'),
    lowest_risk_scenario: byLowest('risk_score'),
    greatest_savings_opportunity: byLowest('tco_period_cost'),
  };
};

const generateRecommendationSummary = async caseId => {
  let results = (await pool.query(
    `SELECT r.*, o.offer_name, o.supplier_name
       FROM procurement_evaluation_results r
       JOIN procurement_evaluation_offers o ON o.id = r.offer_id
      WHERE r.evaluation_case_id = $1
      ORDER BY r.rank NULLS LAST, r.final_weighted_score DESC`,
    [caseId]
  )).rows;
  if (results.length === 0) results = await calculateAllOfferResults(caseId);
  const lowestTco = [...results].sort((a, b) => toNumber(a.tco_period_cost) - toNumber(b.tco_period_cost))[0];
  const bestAvg = [...results].sort((a, b) => toNumber(a.average_cost_per_reported_test) - toNumber(b.average_cost_per_reported_test))[0];
  const bestScore = [...results].sort((a, b) => toNumber(b.final_weighted_score) - toNumber(a.final_weighted_score))[0];
  const warnings = results.filter(row => row.commitment_warning).map(row => row.commitment_warning);
  return {
    lowest_tco_offer: lowestTco || null,
    lowest_average_cost_offer: bestAvg || null,
    best_final_weighted_score_offer: bestScore || null,
    risk_warnings: warnings,
    final_recommended_offer: bestScore || lowestTco || null,
    advantages: bestScore ? [`Highest weighted score: ${bestScore.final_weighted_score}`, lowestTco && Number(bestScore.offer_id) === Number(lowestTco.offer_id) ? 'Lowest TCO scenario' : null].filter(Boolean) : [],
    disadvantages: bestScore && lowestTco && Number(bestScore.offer_id) !== Number(lowestTco.offer_id) ? [`Not the lowest TCO; ${lowestTco.offer_name || lowestTco.offer_id} is financially lower.`] : [],
    hidden_costs: warnings,
    risks: results.filter(row => row.risk_score && Number(row.risk_score) > 70).map(row => `${row.offer_name || row.offer_id} has elevated risk score ${row.risk_score}`),
    long_term_implications: bestScore ? [`${bestScore.offer_name || `Scenario #${bestScore.offer_id}`} has ${bestScore.tco_period_cost} period TCO and ${bestScore.average_cost_per_reported_test} average cost per unit.`] : [],
    summary: bestScore ? `${bestScore.offer_name || `Scenario #${bestScore.offer_id}`} is recommended because it has the highest weighted score (${bestScore.final_weighted_score}). ${lowestTco ? `Lowest TCO scenario: ${lowestTco.offer_name || lowestTco.offer_id}.` : ''}` : 'No recommendation available until scenarios are calculated.',
  };
};

const canonical = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const COLUMN_ALIASES = {
  test_name: ['item','item_name','kit','kit_name','test','test_name','name'],
  test_code: ['code','item_code','kit_code','test_code'],
  category: ['category','type'],
  unit: ['unit','uom'],
  kit_price: ['price','unit_price','kit_price','cost'],
  tests_per_kit: ['tests_kit','tests_per_kit','kit_size','pack_size'],
  shelf_life_months: ['shelf_life','shelf_life_months'],
  open_vial_stability_days: ['stability','open_kit_stability','open_vial_stability','open_kit_stability_days'],
  onboard_stability_days: ['onboard_stability','onboard_stability_days'],
  expected_monthly_volume: ['monthly_volume','volume','expected_monthly_volume'],
  price_per_reportable_test: ['reportable_price','pay_per_reportable','price_per_reportable_test'],
  expected_waste_percentage: ['waste','waste_percent','waste_percentage'],
  repeat_rate_percentage: ['repeat','repeat_percent','repeat_percentage'],
  qc_cost_per_kit: ['qc_cost','qc_cost_per_kit'],
  calibrator_cost_per_kit: ['calibrator_cost','calibrator_cost_per_kit'],
  fixed_consumable_cost_per_kit: ['fixed_consumables','fixed_consumable_cost_per_kit'],
  pricing_method: ['pricing_method','commercial_model','pricing_model'],
  notes: ['notes','comment','comments'],
};

const autoMapColumns = headers => {
  const result = {};
  const normalized = headers.map(header => ({ header, key: canonical(header) }));
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = normalized.find(item => aliases.includes(item.key));
    if (match) result[field] = match.header;
  }
  return result;
};

const parseDelimitedText = text => {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const parseLine = line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, ''));
  const headers = parseLine(lines[0]);
  return { headers, rows: lines.slice(1).map(line => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value]))) };
};

const validateImportRows = (rows, columnMap = autoMapColumns(Object.keys(rows[0] || {}))) => {
  const seen = new Set();
  return rows.map((raw, index) => {
    const item = {};
    for (const [field, source] of Object.entries(columnMap || {})) item[field] = raw[source];
    const errors = [];
    const key = canonical(`${item.test_code || ''}:${item.test_name || ''}`);
    if (!item.test_name) errors.push('missing item name');
    if (!item.kit_price && !item.price_per_reportable_test) errors.push('missing price');
    if (key && seen.has(key)) errors.push('duplicate row');
    seen.add(key);
    if (item.pricing_method && !PRICING_MODELS.has(item.pricing_method) && !PRICING_METHODS.has(item.pricing_method)) errors.push('invalid pricing method');
    ['kit_price','tests_per_kit','open_vial_stability_days','expected_monthly_volume','price_per_reportable_test','expected_waste_percentage','repeat_rate_percentage','qc_cost_per_kit','calibrator_cost_per_kit','fixed_consumable_cost_per_kit'].forEach(field => {
      if (item[field] !== undefined && item[field] !== '' && !Number.isFinite(Number(item[field]))) errors.push(`invalid ${field}`);
    });
    if (item.tests_per_kit !== undefined && item.tests_per_kit !== '' && Number(item.tests_per_kit) <= 0) errors.push('invalid tests per kit');
    return { row_number: index + 2, raw, item, errors, valid: errors.length === 0 };
  });
};

const calculatePracticalUtilization = (testCost, monthlyVolume) => {
  const annualVolume = toNumber(monthlyVolume) * 12;
  const testsPerKit = toNumber(testCost.tests_per_kit || testCost.usable_tests_per_kit);
  const kitPrice = toNumber(testCost.kit_price);
  const openDays = toNumber(testCost.open_vial_stability_days);
  const kitsByVolume = testsPerKit > 0 ? Math.ceil(annualVolume / testsPerKit) : 0;
  const kitsByStability = openDays > 0 && annualVolume > 0 ? Math.ceil(365 / openDays) : kitsByVolume;
  const actualKitsNeeded = Math.max(kitsByVolume, kitsByStability);
  const capacity = actualKitsNeeded * testsPerKit;
  const wastedTests = Math.max(0, capacity - annualVolume);
  const annualKitCost = money(actualKitsNeeded * (kitPrice + toNumber(testCost.qc_cost_per_kit) + toNumber(testCost.calibrator_cost_per_kit) + toNumber(testCost.fixed_consumable_cost_per_kit) + toNumber(testCost.other_kit_related_cost)));
  const annualPay = money(annualVolume * toNumber(testCost.price_per_reportable_test));
  const effective = annualVolume > 0 ? Number((annualKitCost / annualVolume).toFixed(4)) : 0;
  const saving = annualPay > 0 ? money(Math.abs(annualKitCost - annualPay)) : 0;
  const warnings = [];
  const utilization = capacity > 0 ? Number(((annualVolume / capacity) * 100).toFixed(2)) : 0;
  if (utilization < 50 && capacity > 0) warnings.push('low utilization');
  if (wastedTests > testsPerKit) warnings.push('high wastage');
  if (kitsByStability > kitsByVolume) warnings.push('stability limitations');
  return { annual_volume: annualVolume, kits_needed_by_volume: kitsByVolume, kits_needed_by_stability: kitsByStability, actual_kits_needed: actualKitsNeeded, wasted_tests: wastedTests, utilization_percentage: utilization, effective_cost_per_reported_test: effective, annual_kit_cost: annualKitCost, annual_pay_per_reportable_cost: annualPay, annual_saving: saving, best_pricing_method: annualPay > 0 && annualPay < annualKitCost ? 'PAY_PER_REPORTABLE' : 'KIT_OWNERSHIP', recommendation_reason: annualPay > 0 && annualPay < annualKitCost ? 'Pay per reportable is cheaper after stability and wastage.' : 'Kit ownership is cheaper or no pay-per-reportable price was offered.', warnings };
};


module.exports = {
  COMMERCIAL_MODELS,
  PRICING_METHODS,
  PRICING_MODELS,
  normalizePercent,
  calculateInitialCost,
  calculateAnnualFixedCost,
  calculateKitOwnershipCost,
  calculatePayPerReportableCost,
  calculateRecurringElementCost,
  calculateOfferAnnualVariableCost,
  calculateOfferTco,
  calculateAllOfferResults,
  rankOffers,
  calculateCostPerReportedTest,
  calculateSensitivityAnalysis,
  calculateBreakEven,
  optimizeResults,
  generateRecommendationSummary,
  autoMapColumns,
  parseDelimitedText,
  validateImportRows,
  calculatePracticalUtilization,
};