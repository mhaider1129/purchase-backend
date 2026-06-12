jest.mock('../config/db', () => ({ query: jest.fn() }));

const pool = require('../config/db');
const service = require('../services/procurementEvaluationService');

describe('procurement evaluation service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calculates KIT_OWNERSHIP effective cost with normalized percentages', () => {
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

    expect(result.calculated_effective_cost_per_reported_test).toBeCloseTo(12.8655, 4);
    expect(result.annual_test_cost).toBe(15438.6);
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