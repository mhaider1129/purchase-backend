const { validateAndSnapshotRoute, ApprovalRouteError } = require('../services/approvalRouteResolver');
const { createApprovalEngine } = require('../services/approvalEngine');

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
  test('route version participates in snapshot identity', () => {
    const route = [{ id: 9, approval_level: 1, role: 'HOD' }];
    const version1 = validateAndSnapshotRoute(route, { requestType: 'Stock', approvalRouteVersion: 1 });
    const version2 = validateAndSnapshotRoute(route, { requestType: 'Stock', approvalRouteVersion: 2 });
    expect(version1.version).toBe(1);
    expect(version2.version).toBe(2);
    expect(version1.snapshotId).not.toBe(version2.snapshotId);
    expect(validateAndSnapshotRoute(route, { requestType: 'Stock', approvalRouteVersion: version2.version }).snapshotId).toBe(version2.snapshotId);
  });
  test('createSteps stores a snapshot and matching snapshot id on the request', async () => {
    const snapshot = validateAndSnapshotRoute([{ approval_level: 1, approver_id: 42 }], { approvalRouteVersion: 2 });
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 70 }], rowCount: 1 });
    const repository = {
      lockRequest: jest.fn().mockResolvedValue({ id: 17 }),
      getCurrentLevel: jest.fn().mockResolvedValue(null),
    };
    await createApprovalEngine({ repository, audit: jest.fn(), notify: jest.fn() }).createSteps(
      { requestId: 17, routeSnapshot: snapshot, actor: { id: 8 }, correlationId: 'route-v2' },
      { query },
    );
    const storageCall = query.mock.calls.find(([sql]) => sql.includes('UPDATE requests SET approval_route_snapshot='));
    expect(JSON.parse(storageCall[1][0])).toEqual(snapshot);
    expect(storageCall[1][1]).toBe(snapshot.snapshotId);
  });
  test('createSteps carries an approval to a matching approver in the replacement route', async () => {
    const snapshot = validateAndSnapshotRoute([
      { approval_level: 1, approver_id: 42 },
      { approval_level: 2, approver_id: 51 },
    ], { approvalRouteVersion: 3 });
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 70 }], rowCount: 1 });
    const repository = {
      lockRequest: jest.fn().mockResolvedValue({ id: 17 }),
      getCurrentLevel: jest.fn().mockResolvedValue(2),
      activateLevel: jest.fn().mockResolvedValue([{ id: 71, approver_id: 51 }]),
    };
    const notify = jest.fn();
    await createApprovalEngine({ repository, audit: jest.fn(), notify }).createSteps({
      requestId: 17,
      routeSnapshot: snapshot,
      actor: { id: 8 },
      correlationId: 'route-v3',
      inheritedDecisions: [{ approver_id: 42, status: 'Approved', comments: 'Previously approved', approved_at: '2026-08-29T10:00:00Z' }],
    }, { query });

    const inserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO approvals'));
    expect(inserts[0][1].slice(5)).toEqual(['Approved', 'Previously approved', '2026-08-29T10:00:00Z', '2026-08-29T10:00:00Z']);
    expect(inserts[1][1][5]).toBe('Pending');
    expect(repository.activateLevel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2);
    expect(notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 51 }));
  });
});