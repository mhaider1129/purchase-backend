const loadEnsureHistoricalRequestSchema = () => {
  jest.resetModules();
  jest.doMock('../config/db', () => ({ query: jest.fn() }));
  jest.doMock('../utils/ensureProjectsTable', () => jest.fn(() => Promise.resolve()));
  jest.doMock('../utils/ensureWarehouseAssignments', () => jest.fn(() => Promise.resolve()));

  return {
    ensureHistoricalRequestSchema: require('../utils/ensureHistoricalRequestSchema'),
    ensureProjectsTable: require('../utils/ensureProjectsTable'),
    ensureWarehouseAssignments: require('../utils/ensureWarehouseAssignments'),
  };
};

describe('ensureHistoricalRequestSchema', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.dontMock('../config/db');
    jest.dontMock('../utils/ensureProjectsTable');
    jest.dontMock('../utils/ensureWarehouseAssignments');
  });

  it('backfills request and requested item columns needed by historical imports', async () => {
    const { ensureHistoricalRequestSchema, ensureProjectsTable, ensureWarehouseAssignments } =
      loadEnsureHistoricalRequestSchema();
    const queryable = { query: jest.fn(() => Promise.resolve({ rows: [] })) };

    await ensureHistoricalRequestSchema(queryable);

    const executedSql = queryable.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(ensureProjectsTable).toHaveBeenCalledWith(queryable);
    expect(ensureWarehouseAssignments).toHaveBeenCalledWith(queryable);
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS request_domain');
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS brand');
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS total_cost');
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS available_quantity');
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS intended_use');
    expect(executedSql).toContain('ADD COLUMN IF NOT EXISTS specs');
  });
});