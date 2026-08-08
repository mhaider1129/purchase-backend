const { validateAndSnapshotRoute, ApprovalRouteError } = require('../services/approvalRouteResolver');

describe('approvalRouteResolver', () => {
  const contexts = [
    ['medical stock', { requestType: 'Stock', classification: 'medical' }],
    ['medical non-stock', { requestType: 'Non-Stock', classification: 'medical' }],
    ['operational stock', { requestType: 'Stock', classification: 'operational' }],
    ['operational non-stock', { requestType: 'Non-Stock', classification: 'operational' }],
    ['medical device', { requestType: 'Medical Device', classification: 'medical' }],
    ['maintenance', { requestType: 'Maintenance', classification: 'operational', maintenanceClassification: 'preventive' }],
  ];
  test.each(contexts)('%s produces a deterministic preserved snapshot', (_name, context) => {
    const route = [{ id: 9, approval_level: 1, role: 'HOD' }, { id: 10, approval_level: 2, approver_id: 42 }];
    const first = validateAndSnapshotRoute(route, { ...context, cost: 5000 });
    route[0].role = 'CEO';
    expect(first.steps[0].role).toBe('HOD');
    expect(first.snapshotId).toHaveLength(64);
    expect(validateAndSnapshotRoute([{ id: 9, approval_level: 1, role: 'HOD' }, { id: 10, approval_level: 2, approver_id: 42 }], { ...context, cost: 5000 }).snapshotId).toBe(first.snapshotId);
  });
  test('rejects missing routes', () => expect(() => validateAndSnapshotRoute([], {})).toThrow(expect.objectContaining({ code: 'MISSING_ROUTE' })));
  test('rejects missing approvers', () => expect(() => validateAndSnapshotRoute([{ approval_level: 1 }], {})).toThrow(ApprovalRouteError));
  test('preserves multiple configured members at one level', () => {
    const snapshot = validateAndSnapshotRoute([{ approval_level: 1, approver_id: 7 }, { approval_level: 1, approver_id: 8 }], {});
    expect(snapshot.steps).toHaveLength(2);
    expect(snapshot.levels).toEqual([{ level: 1, members: expect.arrayContaining([expect.objectContaining({ approverId: 7 }), expect.objectContaining({ approverId: 8 })]) }]);
  });
  test('rejects an identical member twice within a level', () => expect(() => validateAndSnapshotRoute([{ approval_level: 1, role: 'HOD' }, { approval_level: 1, role: 'HOD' }], {})).toThrow(expect.objectContaining({ code: 'DUPLICATE_ROUTE_STEP' })));
  test('cost is captured in the immutable snapshot', () => expect(validateAndSnapshotRoute([{ approval_level: 1, role: 'CFO' }], { cost: 100000 }).context.cost).toBe(100000));
});