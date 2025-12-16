jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');

const {
  createSupplierEvaluation,
} = require('../controllers/supplierEvaluationsController');

const COMPLETE_CRITERIA = {
  scheduled_annually: true,
  travel_required: false,
  evaluation_criteria_notes: null,
  overall_supplier_happiness: 4,
  price_satisfaction: 4,
  delivery_as_scheduled: 4,
  delivery_in_good_condition: 4,
  delivery_meets_quality_expectations: 4,
  communication_effectiveness: 4,
  compliance_alignment: 4,
  operations_effectiveness_rating: 4,
  payment_terms_comfort: 4,
};

describe('supplierEvaluationsController', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('rejects creation when user lacks permissions', async () => {
    const req = {
      user: {
        role: 'Requester',
        hasPermission: jest.fn().mockReturnValue(false),
      },
      body: { supplier_name: 'Acme Corp' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createSupplierEvaluation(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('validates that supplier_name is provided', async () => {
    const req = {
      user: {
        role: 'ADMIN',
        hasPermission: jest.fn().mockImplementation(code => code === 'evaluations.manage'),
      },
      body: { quality_score: 80 },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createSupplierEvaluation(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('automatically computes overall score when omitted', async () => {
    const req = {
      user: {
        role: 'SCM',
        id: 5,
        name: 'Alice Johnson',
        hasPermission: jest.fn().mockImplementation(code => code === 'evaluations.manage'),
      },
      body: {
        supplier_name: 'Globex',
        evaluation_date: '2024-01-01',
        quality_score: 80,
        delivery_score: 90,
        compliance_score: 85,
        strengths: 'Reliable delivery',
        criteria_responses: COMPLETE_CRITERIA,
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure table
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure index
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure extended columns
      .mockResolvedValueOnce({ rows: [{ latest_date: null }], rowCount: 1 }) // cadence check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            supplier_name: 'Globex',
            evaluation_date: '2024-01-01',
            quality_score: '80',
            delivery_score: '90',
            cost_score: null,
            compliance_score: '85',
            otif_score: null,
            corrective_actions_score: null,
            esg_compliance_score: null,
            overall_score: '85',
            weighted_overall_score: null,
            kpi_weights: null,
            strengths: 'Reliable delivery',
            weaknesses: null,
            action_items: null,
            evaluator_id: 5,
            evaluator_name: 'Alice Johnson',
            created_at: '2024-01-02T00:00:00.000Z',
            updated_at: '2024-01-02T00:00:00.000Z',
          },
        ],
      });

    await createSupplierEvaluation(req, res, next);

    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        overall_score: 85,
        weighted_overall_score: null,
        supplier_name: 'Globex',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects criteria ratings outside the 1-5 scale', async () => {
    const req = {
      user: {
        role: 'SCM',
        id: 7,
        name: 'Bob Tester',
        hasPermission: jest.fn().mockImplementation(code => code === 'evaluations.manage'),
      },
      body: {
        supplier_name: 'Acme Corp',
        evaluation_date: '2024-02-02',
        quality_score: 75,
        criteria_responses: {
          ...COMPLETE_CRITERIA,
          overall_supplier_happiness: 6,
        },
      },
    };

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createSupplierEvaluation(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('computes weighted KPI scores when KPI data is provided', async () => {
    const req = {
      user: {
        role: 'SCM',
        id: 9,
        name: 'Jordan Smith',
        hasPermission: jest.fn().mockImplementation(code => code === 'evaluations.manage'),
      },
      body: {
        supplier_name: 'Initech',
        otif_score: 92,
        corrective_actions_score: 60,
        esg_compliance_score: 88,
        strengths: 'Great ESG focus',
        criteria_responses: COMPLETE_CRITERIA,
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            supplier_name: 'Initech',
            evaluation_date: expect.any(String),
            quality_score: null,
            delivery_score: null,
            cost_score: null,
            compliance_score: null,
            otif_score: '92',
            corrective_actions_score: '60',
            esg_compliance_score: '88',
            overall_score: '79.8',
            weighted_overall_score: '79.8',
            kpi_weights: JSON.stringify({
              otif: 0.4,
              corrective_actions: 0.35,
              esg_compliance: 0.25,
            }),
            strengths: 'Great ESG focus',
            weaknesses: null,
            action_items: null,
            evaluator_id: 9,
            evaluator_name: 'Jordan Smith',
            created_at: '2024-02-01T00:00:00.000Z',
            updated_at: '2024-02-01T00:00:00.000Z',
          },
        ],
      });

    await createSupplierEvaluation(req, res, next);

    expect(pool.query).toHaveBeenCalled();
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO supplier_evaluations')
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall[1];
    expect(insertParams[6]).toBe(92);
    expect(insertParams[7]).toBe(60);
    expect(insertParams[8]).toBe(88);
    expect(insertParams[9]).toBe(79.8);
    expect(insertParams[10]).toBe(79.8);
    expect(JSON.parse(insertParams[11])).toEqual(
      expect.objectContaining({
        otif: expect.any(Number),
        corrective_actions: expect.any(Number),
        esg_compliance: expect.any(Number),
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});