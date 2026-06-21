jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn().mockResolvedValue());
jest.mock('../utils/ensureWarehouseSupplyTables', () => ({
  ensureWarehouseSupplyApprovalColumns: jest.fn().mockResolvedValue(),
}));
jest.mock('../controllers/requests/assignRequestController', () => ({
  ensureRequestedItemAssignmentColumns: jest.fn().mockResolvedValue(),
}));

const pool = require('../config/db');
const ensureRequestedItemApprovalColumns = require('../utils/ensureRequestedItemApprovalColumns');
const { ensureWarehouseSupplyApprovalColumns } = require('../utils/ensureWarehouseSupplyTables');
const { getApprovalHistory } = require('../controllers/requests/fetchRequestsController');

const buildRes = () => {
  const res = {};
  res.json = jest.fn(() => res);
  return res;
};

const getApprovalHistoryQuery = () => pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM approvals a'));

describe('fetchRequestsController.getApprovalHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureRequestedItemApprovalColumns.mockResolvedValue();
    ensureWarehouseSupplyApprovalColumns.mockResolvedValue();
    pool.query.mockImplementation((sql) => {
      if (String(sql).includes('to_regclass')) {
        return Promise.resolve({ rows: [{ table_name: 'warehouse_supply_items' }] });
      }
      if (String(sql).includes('information_schema.columns')) {
        return Promise.resolve({
          rows: [
            { column_name: 'approval_status' },
            { column_name: 'approval_comments' },
            { column_name: 'approved_at' },
            { column_name: 'approved_by' },
            { column_name: 'unit_cost' },
            { column_name: 'total_cost' },
          ],
        });
      }

      return Promise.resolve({ rows: [] });
    });
  });

  it('ignores blank optional filters sent by the approval history page', async () => {
    const req = {
      query: { status: '', from_date: '', to_date: '', department_id: '' },
      user: { id: 7, institute_id: 3 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [7, 3]);
    expect(getApprovalHistoryQuery()[0]).not.toContain("AND r.department_id = $");
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('ignores unsupported status filters instead of sending them to SQL', async () => {
    const req = {
      query: { status: 'Pending' },
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [7]);
    expect(getApprovalHistoryQuery()[0]).not.toContain('a.status = $2');
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('only adds department and date filters when they are valid values', async () => {
    const req = {
      query: { department_id: '4', from_date: '2026-06-01', to_date: 'bad-date' },
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('r.department_id = $2'), [7, 4, '2026-06-01']);
    expect(getApprovalHistoryQuery()[0]).toContain('a.approved_at >= $3');
    expect(getApprovalHistoryQuery()[0]).not.toContain('a.approved_at <=');
  });

  it('omits warehouse supply item history when the table is unavailable', async () => {
    pool.query.mockImplementation((sql) => {
      if (String(sql).includes('to_regclass')) {
        return Promise.resolve({ rows: [{ table_name: null }] });
      }
      if (String(sql).includes('information_schema.columns')) {
        return Promise.resolve({
          rows: [
            { column_name: 'approval_status' },
            { column_name: 'approval_comments' },
            { column_name: 'approved_at' },
            { column_name: 'approved_by' },
            { column_name: 'unit_cost' },
            { column_name: 'total_cost' },
          ],
        });
      }

      return Promise.resolve({ rows: [] });
    });

    const req = {
      query: {},
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith('SELECT to_regclass($1) AS table_name', ['public.warehouse_supply_items']);
    expect(getApprovalHistoryQuery()[0]).toContain('FROM public.requested_items ri');
    expect(getApprovalHistoryQuery()[0]).not.toContain('FROM public.warehouse_supply_items wsi');
    expect(res.json).toHaveBeenCalledWith([]);
  });


  it('omits item history joins when approval item columns are not available', async () => {
    pool.query.mockImplementation((sql) => {
      if (String(sql).includes('to_regclass')) {
        return Promise.resolve({ rows: [{ table_name: 'warehouse_supply_items' }] });
      }
      if (String(sql).includes('information_schema.columns')) {
        return Promise.resolve({ rows: [] });
      }

      return Promise.resolve({ rows: [] });
    });

    const req = {
      query: {},
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getApprovalHistoryQuery()[0]).not.toContain('approved_items.items');
    expect(getApprovalHistoryQuery()[0]).not.toContain('FROM public.requested_items ri');
    expect(res.json).toHaveBeenCalledWith([]);
  });


  it('retries approval history without item details when item-detail SQL fails at runtime', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let historyQueryCount = 0;

    pool.query.mockImplementation((sql) => {
      const sqlText = String(sql);
      if (sqlText.includes('to_regclass')) {
        return Promise.resolve({ rows: [{ table_name: 'warehouse_supply_items' }] });
      }
      if (sqlText.includes('information_schema.columns')) {
        return Promise.resolve({
          rows: [
            { column_name: 'approval_status' },
            { column_name: 'approval_comments' },
            { column_name: 'approved_at' },
            { column_name: 'approved_by' },
            { column_name: 'unit_cost' },
            { column_name: 'total_cost' },
          ],
        });
      }
      if (sqlText.includes('FROM approvals a')) {
        historyQueryCount += 1;
        if (historyQueryCount === 1) {
          return Promise.reject(Object.assign(new Error('column ri.approved_by does not exist'), { code: '42703' }));
        }
      }

      return Promise.resolve({ rows: [] });
    });

    const req = {
      query: {},
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();

    await getApprovalHistory(req, res, next);

    const historyQueries = pool.query.mock.calls.filter(([sql]) => String(sql).includes('FROM approvals a'));
    expect(next).not.toHaveBeenCalled();
    expect(historyQueries).toHaveLength(2);
    expect(historyQueries[0][0]).toContain('approved_items.items');
    expect(historyQueries[1][0]).not.toContain('approved_items.items');
    expect(res.json).toHaveBeenCalledWith([]);

    warnSpy.mockRestore();
  });

  it('continues when runtime schema checks are blocked by database DDL permissions', async () => {
    ensureRequestedItemApprovalColumns.mockRejectedValueOnce(
      Object.assign(new Error('permission denied for schema public'), { code: '42501' }),
    );

    const req = {
      query: {},
      user: { id: 7 },
    };
    const res = buildRes();
    const next = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await getApprovalHistory(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM approvals a'), [7]);
    expect(res.json).toHaveBeenCalledWith([]);

    warnSpy.mockRestore();
  });
});