jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');

const {
  createSupplierEvaluation,
} = require('../controllers/supplierEvaluationsController');

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
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure table
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure index
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
            overall_score: '85',
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

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        overall_score: 85,
        supplier_name: 'Globex',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});