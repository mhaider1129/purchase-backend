jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../utils/ensureTechnicalInspectionsTable', () => jest.fn().mockResolvedValue());
const { getInspectionSummaryForRequest, applyRequestStatusFromInspections } = require('../utils/technicalInspectionStatus');

// Real compatibility helper, stubbed read-only runner: no request writer is
// reachable for any status, approval state or procurement fulfilment state.
test.each(['Submitted','Rejected','Cancelled','Approved','On Hold','completed','Received','Closed'])('%s is unchanged by inspection evidence', async status => {
  const request = { status, completed_at: 'historical', active_approval: true, ordered: 1, required: 5 };
  const before = { ...request };
  const runner = { query: jest.fn(async sql => {
    if (/\b(UPDATE|INSERT|DELETE)\b/i.test(sql)) throw new Error('Evidence must never write');
    return { rows: [{ pending_count: 0, total_count: 1 }] };
  }) };
  expect(await applyRequestStatusFromInspections(runner, { requestId: 41 })).toEqual({ pendingCount: 0, totalCount: 2, appliedStatus: null, statusUpdated: false });
  expect(request).toEqual(before);
  expect(runner.query).toHaveBeenCalledTimes(2);
});
test.each([
  [2, 3, 0, 0, 2, 3], // multiple legacy inspections, some pending
  [0, 1, 1, 1, 1, 2], // passed legacy form cannot clear partial GR acceptance
  [0, 0, 1, 1, 1, 1], // required GR task pending
  [0, 0, 0, 0, 0, 0], // no inspections
])('summary keeps legacy and receiving evidence separate (%s,%s,%s,%s)', async (lp, lt, gp, gt, pendingCount, totalCount) => {
  const runner = { query: jest.fn().mockResolvedValueOnce({ rows: [{ pending_count: lp, total_count: lt }] }).mockResolvedValueOnce({ rows: [{ pending_count: gp, total_count: gt }] }) };
  expect(await getInspectionSummaryForRequest(runner, 41)).toEqual({ pendingCount, totalCount });
  const receivingSql = runner.query.mock.calls[1][0];
  expect(receivingSql).toContain('technical_accepted_quantity');
  expect(receivingSql).toContain('technical_inspection_required');
  expect(receivingSql).toContain('actual.accepted_quantity<poi.quantity');
});
