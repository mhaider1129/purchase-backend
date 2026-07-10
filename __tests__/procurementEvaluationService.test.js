jest.mock('../config/db', () => ({ query: jest.fn() }));

const pool = require('../config/db');
const service = require('../services/procurementEvaluationService');

describe('procurement evaluation service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calculates KIT_OWNERSHIP effective cost with per-test QC, calibrator, and fixed consumables', () => {
    const result = service.calculateKitOwnershipCost({
      kit_price: 1000,
      tests_per_kit: 100,
      expected_waste_percentage: 10,
      repeat_rate_percentage: 5,
      qc_cost_per_kit: 50,
      calibrator_cost_per_kit: 25,
      fixed_consumable_cost_per_kit: 25,
      other_kit_related_cost: 0,
    }, 1200);

    expect(result.calculated_effective_cost_per_reported_test).toBeCloseTo(111.6959, 4);
    expect(result.annual_test_cost).toBe(134035.09);
  });

  test('calculates PAY_PER_REPORTABLE without waste, QC, or repeat uplift', () => {
    const result = service.calculatePayPerReportableCost({ price_per_reportable_test: 7.5 }, 1000);
    expect(result).toEqual({
      calculated_effective_cost_per_reported_test: 7.5,
      annual_test_cost: 7500,
    });
  });

  test('calculates initial and annual fixed costs', () => {
    expect(service.calculateInitialCost({ device_price: 100, installation_cost: 20, training_cost: 10, shipping_cost: 5, customs_cost: 5, other_initial_cost: 10, device_discount_value: 25 })).toBe(125);
    expect(service.calculateAnnualFixedCost({ annual_maintenance_cost: 10, annual_service_contract_cost: 20, annual_fixed_consumables_cost: 30, annual_calibration_qc_cost: 40, annual_spare_parts_cost: 50 })).toBe(150);
  });

  test('calculates 5-year TCO with growth for a hybrid offer', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 5, expected_annual_growth_rate: 0.1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: 'HYBRID', device_price: 1000, annual_maintenance_cost: 100 }] })
      .mockResolvedValueOnce({ rows: [
        { pricing_method: 'KIT_OWNERSHIP', expected_monthly_volume: 10, kit_price: 100, tests_per_kit: 100, expected_waste_percentage: 0, repeat_rate_percentage: 0 },
        { pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 20, price_per_reportable_test: 2 },
      ] });

    const result = await service.calculateOfferTco(1, 2);
    expect(result.annual_variable_test_cost).toBe(600);
    expect(result.total_annual_cost).toBe(700);
    expect(result.tco_period_cost).toBe(5273.57);
  });

  test('calculates REAGENT_RENTAL minimum commitment adjustment and volume shortfall', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: 'REAGENT_RENTAL', minimum_annual_commitment_amount: 5000, minimum_annual_commitment_tests: 1000 }] })
      .mockResolvedValueOnce({ rows: [
        { pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 50, price_per_reportable_test: 5 },
      ] });

    const result = await service.calculateOfferTco(1, 2);
    expect(result.annual_variable_test_cost).toBe(3000);
    expect(result.annual_commitment_adjustment).toBe(2000);
    expect(result.total_annual_cost).toBe(5000);
    expect(result.commitment_volume_shortfall).toBe(true);
    expect(result.shortfall_tests).toBe(400);
  });

  test('ranks lowest TCO highest when weighted scores tie', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10 }, { id: 20 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10, pricing_model: 'PAY_PER_REPORTABLE', device_price: 100, delivery_time_days: 10, warranty_years: 1 }] })
      .mockResolvedValueOnce({ rows: [{ pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 10, price_per_reportable_test: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 20, pricing_model: 'PAY_PER_REPORTABLE', device_price: 500, delivery_time_days: 10, warranty_years: 1 }] })
      .mockResolvedValueOnce({ rows: [{ pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 10, price_per_reportable_test: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, criteria_name: 'Total Cost of Ownership', weight: 100, scoring_type: 'automatic' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const results = await service.rankOffers(1);
    expect(results[0].offer_id).toBe(10);
    expect(results[0].rank).toBe(1);
  });
});
test('calculates practical utilization using open-kit stability instead of simple kit price division', () => {
  const result = service.calculatePracticalUtilization({ kit_price: 500, tests_per_kit: 100, open_vial_stability_days: 30, price_per_reportable_test: 12 }, 10);
  expect(result.annual_volume).toBe(120);
  expect(result.kits_needed_by_volume).toBe(2);
  expect(result.kits_needed_by_stability).toBe(13);
  expect(result.actual_kits_needed).toBe(13);
  expect(result.effective_cost_per_reported_test).toBeCloseTo(54.1667, 4);
  expect(result.best_pricing_method).toBe('PAY_PER_REPORTABLE');
  expect(result.warnings).toContain('low utilization');
});

test('auto maps and validates pasted Excel-style import rows', () => {
  const parsed = service.parseDelimitedText('Item Name\tCode\tKit Price\tTests/Kit\tStability\tMonthly Volume\nA\tA1\t500\t100\t30\t10');
  const map = service.autoMapColumns(parsed.headers);
  const rows = service.validateImportRows(parsed.rows, map);
  expect(map.test_name).toBe('Item Name');
  expect(map.kit_price).toBe('Kit Price');
  expect(map.tests_per_kit).toBe('Tests/Kit');
  expect(rows[0].valid).toBe(true);
  expect(rows[0].item.test_name).toBe('A');
});

test('supports strategic commercial model catalog and generic recurring elements', () => {
  expect(service.COMMERCIAL_MODELS).toContain('OUTSOURCING');
  expect(service.COMMERCIAL_MODELS).toContain('SERVICE_CONTRACT');
  const result = service.calculateRecurringElementCost({ pricing_method: 'SUBSCRIPTION', unit_cost: 250, annual_quantity: 12 }, 1200);
  expect(result.annual_test_cost).toBe(3000);
  expect(result.calculated_effective_cost_per_reported_test).toBe(2.5);
});

test('calculates break-even between two strategic scenarios', () => {
  const result = service.calculateBreakEven(
    { name: 'Purchase', initial_cost: 10000, fixed_annual_cost: 1000, variable_cost_per_unit: 1 },
    { name: 'Pay per use', initial_cost: 0, fixed_annual_cost: 0, variable_cost_per_unit: 5 },
    10000
  );
  expect(result.break_even_volume).toBeGreaterThan(0);
  expect(result.cheaper_below).toBe('Pay per use');
});
test('parses quoted CSV cells, currency symbols, percentages, and Arabic headers', () => {
  const parsed = service.parseDelimitedText('اسم الصنف,سعر الكيت,Monthly Volume,Notes\n"Panel, A","$1,200.50",10,"quoted, note"');
  const map = service.autoMapColumns(parsed.headers);
  const rows = service.validateImportRows(parsed.rows, map);
  expect(map.test_name).toBe('اسم الصنف');
  expect(rows[0].item.test_name).toBe('Panel, A');
  expect(rows[0].item.kit_price).toBe('1200.50');
  expect(rows[0].valid).toBe(true);
});

test('calculates lease, subscription, outsourcing, and service contract commercial costs', async () => {
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: 'LEASE', lease_monthly_payment: 100, annual_maintenance_cost: 0 }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(service.calculateOfferTco(1, 2)).resolves.toMatchObject({ total_annual_cost: 1200, tco_period_cost: 1200 });

  pool.query.mockReset();
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3, pricing_model: 'SUBSCRIPTION', subscription_base_fee: 100, included_volume: 100, overage_price: 2 }] })
    .mockResolvedValueOnce({ rows: [{ pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 10, price_per_reportable_test: 1 }] });
  await expect(service.calculateOfferTco(1, 3)).resolves.toMatchObject({ total_annual_cost: 1360, risk_adjusted_tco: 1360 });
});

test('risk-adjusted TCO adds explicit risk premium fields', async () => {
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: 'PURCHASE', device_price: 1000, downtime_cost: 100, supplier_risk_premium: 50 }] })
    .mockResolvedValueOnce({ rows: [] });
  const result = await service.calculateOfferTco(1, 2);
  expect(result.tco_period_cost).toBe(1000);
  expect(result.risk_adjusted_tco).toBe(1150);
});

test('ignores unfilled test cost rows while calculating an offer', async () => {
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: 'PAY_PER_REPORTABLE' }] })
    .mockResolvedValueOnce({ rows: [
      { pricing_method: 'KIT_OWNERSHIP', expected_monthly_volume: 10, kit_price: null, tests_per_kit: null, price_per_reportable_test: null, unit_cost: null, annual_test_cost: null, calculated_effective_cost_per_reported_test: null },
      { pricing_method: 'PAY_PER_REPORTABLE', expected_monthly_volume: 20, price_per_reportable_test: 2 },
    ] });

  const result = await service.calculateOfferTco(1, 2);
  expect(result.annual_variable_test_cost).toBe(480);
  expect(result.total_expected_reported_tests).toBe(240);
  expect(result.tests).toHaveLength(1);
});

test('defaults missing offer pricing model to purchase during calculation', async () => {
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, evaluation_period_years: 1, expected_annual_growth_rate: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, pricing_model: null, device_price: 100 }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.calculateOfferTco(1, 2);
  expect(result.pricing_model).toBe('PURCHASE');
  expect(result.tco_period_cost).toBe(100);
});