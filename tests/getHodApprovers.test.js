jest.mock('../config/db', () => ({ query: jest.fn() }));

const pool = require('../config/db');
const { getHodApprovers } = require('../controllers/requests/fetchRequestsController');

describe('getHodApprovers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes active COO, SCM, and Medical Devices users in the final approver list', async () => {
    const rows = [
      { id: 1, name: 'COO User', role: 'COO' },
      { id: 2, name: 'SCM User', role: 'SCM' },
      { id: 3, name: 'HOD User', role: 'HOD' },
      { id: 4, name: 'Medical Devices User', role: 'Medical Devices' },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getHodApprovers({ user: { role: 'SCM' } }, res, next);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("IN ('hod', 'coo', 'scm', 'medicaldevices')"),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('REGEXP_REPLACE(LOWER(TRIM(u.role))'));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('u.role'));
    expect(res.json).toHaveBeenCalledWith(rows);
    expect(next).not.toHaveBeenCalled();
  });
});