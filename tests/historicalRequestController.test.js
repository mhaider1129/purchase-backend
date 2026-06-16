jest.mock('../config/db', () => ({ connect: jest.fn() }));
jest.mock('../utils/ensureHistoricalRequestSchema', () => jest.fn(() => Promise.resolve()));

const pool = require('../config/db');
const { insertHistoricalRequest } = require('../controllers/requests/historicalRequestController');

const makeRes = () => ({
  status: jest.fn(function status() { return this; }),
  json: jest.fn(function json() { return this; }),
});

const makeClient = (queryImpl) => ({
  query: jest.fn(queryImpl),
  release: jest.fn(),
});

describe('insertHistoricalRequest', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a 404 instead of a database 500 when requester_id does not exist', async () => {
    const client = makeClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [], rowCount: 0 });
      if (String(sql).includes('SELECT type, institute_id FROM departments')) {
        return Promise.resolve({ rows: [{ type: 'operational', institute_id: 1 }], rowCount: 1 });
      }
      if (String(sql).includes('SELECT id FROM users WHERE id = $1')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 10, institute_id: 1 },
      body: {
        request_type: 'Non-Stock',
        department_id: 2,
        requester_id: 999,
        items: [{ item_name: 'Paper', quantity: 1 }],
      },
    };
    const res = makeRes();
    const next = jest.fn();

    await insertHistoricalRequest(req, res, next);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: 'Requester not found' }));
    expect(res.status).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('normalizes the legacy non-stock request type spelling before insert', async () => {
    const client = makeClient((sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [], rowCount: 0 });
      if (String(sql).includes('SELECT type, institute_id FROM departments')) {
        return Promise.resolve({ rows: [{ type: 'operational', institute_id: 1 }], rowCount: 1 });
      }
      if (String(sql).includes('SELECT id FROM users WHERE id = $1')) {
        return Promise.resolve({ rows: [{ id: params[0] }], rowCount: 1 });
      }
      if (String(sql).includes('INSERT INTO requests')) {
        return Promise.resolve({ rows: [{ id: 123 }], rowCount: 1 });
      }
      if (String(sql).includes('INSERT INTO public.requested_items')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (String(sql).includes('INSERT INTO approvals')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (String(sql).includes('INSERT INTO request_logs')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 10, institute_id: 1 },
      body: {
        request_type: 'Non Stock',
        department_id: 2,
        requester_id: 20,
        items: [{ item_name: 'Paper', quantity: 2, unit_cost: 5 }],
      },
    };
    const res = makeRes();
    const next = jest.fn();

    await insertHistoricalRequest(req, res, next);

    const requestInsertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO requests'));
    expect(requestInsertCall[1][0]).toBe('Non-Stock');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});