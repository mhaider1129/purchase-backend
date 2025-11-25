jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const buildNext = () => jest.fn();

describe('contractEvaluationsController', () => {
  let pool;
  let createContractEvaluation;

  beforeEach(async () => {
    jest.resetModules();
    pool = require('../config/db');
    pool.query.mockReset();
    ({ createContractEvaluation } = require('../controllers/contractEvaluationsController'));
  });

  it('rejects creation when the user lacks permissions', async () => {
    const req = {
      user: { role: 'REQUESTER' },
      body: { contract_id: 12, evaluator_id: 34 },
    };
    const res = buildResponse();
    const next = buildNext();

    await createContractEvaluation(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('allows contract managers to create evaluations and forwards the correct criterion metadata', async () => {
    const req = {
      user: { id: 7, role: 'contract manager' },
      body: { contract_id: 22, evaluator_id: 33, criterion_id: 5 },
    };
    const res = buildResponse();
    const next = buildNext();

    const normalizedComponents = [
      { name: 'Risk Register', score: null },
    ];

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure table exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure columns exist
      .mockResolvedValueOnce({
        rows: [{ id: 22, vendor: 'Test Vendor', title: 'CT Scanner', end_user_department_id: 4 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            name: 'Risk & Issues',
            role: 'Contract Manager',
            code: 'risk_issue_management',
            components: JSON.stringify(normalizedComponents),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // deriveTechnicalInspectionResults
      .mockResolvedValueOnce({ rows: [{ total: 0, completed: 0, avg_lead_time_days: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            contract_id: 22,
            evaluator_id: 33,
            status: 'pending',
            evaluation_notes: null,
            evaluation_criteria: {
              criterionId: 5,
              criterionName: 'Risk & Issues',
              criterionRole: 'Contract Manager',
              criterionCode: 'risk_issue_management',
              components: normalizedComponents,
              overallScore: null,
            },
            criterion_id: 5,
            criterion_name: 'Risk & Issues',
            criterion_role: 'Contract Manager',
            criterion_code: 'risk_issue_management',
          },
        ],
      });

    await createContractEvaluation(req, res, next);

    expect(pool.query).toHaveBeenCalledTimes(7);
    const insertParams = pool.query.mock.calls[6][1];
    expect(insertParams[3]).toBe(5);
    expect(insertParams[6]).toBe('risk_issue_management');

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluation_criteria: expect.objectContaining({
          criterionCode: 'risk_issue_management',
          components: normalizedComponents,
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});