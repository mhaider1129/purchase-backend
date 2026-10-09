jest.mock('../config/db', () => ({ query: jest.fn() }));
const pool = require('../config/db');
const { getMyMaintenanceRequests } = require('../controllers/requests/fetchRequestsController');

beforeEach(() => jest.clearAllMocks());
test.each([true, false])('pending step data retains maintenance viewer scope (view-all=%s)', async (viewAll) => {
  const rows = [{ id: 1, current_pending_approvals: [{ approval_level: 5, approver_role: 'CMO' }] }];
  pool.query.mockResolvedValue({ rows });
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getMyMaintenanceRequests({ user: { id: 10, hasPermission: () => viewAll } }, res, next);
  const [sql, params] = pool.query.mock.calls[0];
  expect(params).toEqual(viewAll ? [] : [10]);
  expect(sql.includes('AND r.initiated_by_technician_id = $1')).toBe(!viewAll);
  expect(sql).toContain("WHERE r.request_type = 'Maintenance'");
  expect(sql).toContain('AS current_pending_approvals');
  expect(sql).toContain("'activated_at', to_jsonb(ap)->>'activated_at'");
  const active = sql.slice(sql.indexOf('SELECT MIN(ap.approval_level)'), sql.indexOf('AS current_pending_approvals'));
  expect(active.match(/ap.is_active = TRUE/g)).toHaveLength(2);
  expect(active.match(/COALESCE\(ap.is_superseded, FALSE\) = FALSE/g)).toHaveLength(2);
  expect(sql).toContain('LEFT JOIN users approver ON approver.id = ap.approver_id');
  expect(res.json).toHaveBeenCalledWith(rows);
  expect(next).not.toHaveBeenCalled();
});
