jest.mock('../policies/requestPolicy', () => ({ assertCanTransition: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/requestLifecycleService', () => ({ resetForReclassification: jest.fn().mockResolvedValue({ after: 'Pending Approval' }) }));
jest.mock('../controllers/utils/approvalRoutes', () => ({
  fetchApprovalRoutes: jest.fn().mockResolvedValue([{ id: 9, approval_level: 1, approver_id: 42, role: 'HOD' }]),
  resolveRouteDomain: jest.fn().mockResolvedValue('medical'),
}));
jest.mock('../services/auditService', () => ({ writeAuditEvent: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/notificationOutboxService', () => ({ enqueueNotification: jest.fn().mockResolvedValue({ created: true }) }));
jest.mock('../services/approvalEngine', () => ({
  supersedeWorkflow: jest.fn().mockResolvedValue({ approvals: [] }),
  createSteps: jest.fn(async ({ routeSnapshot }) => ({ routeSnapshotId: routeSnapshot.snapshotId })),
}));

const crypto = require('crypto');
const { reclassifyRequest } = require('../services/requestReclassificationService');
const approvalEngine = require('../services/approvalEngine');
const outbox = require('../services/notificationOutboxService');

describe('request reclassification snapshot identity', () => {
  const request = {
    id: 17, request_type: 'Non-Stock', request_domain: 'medical', status: 'Returned', requester_id: 5,
    institute_id: 1, department_id: 2, section_id: 3, estimated_cost: 5000, approval_route_snapshot: null,
  };

  const clientForVersion = version => ({
    query: jest.fn(async sql => {
      if (sql.includes('SELECT * FROM requests')) return { rows: [{ ...request }] };
      if (sql.includes('COALESCE(MAX(approval_route_version)')) return { rows: [{ version }] };
      if (sql.includes('SELECT DISTINCT ON (approver_id)')) return { rows: [{ approver_id: 42, status: 'Approved', comments: 'Approved before correction' }] };
      return { rows: [], rowCount: 1 };
    }),
  });

  test('versioned snapshots keep storage identity and outbox keys consistent', async () => {
    const actor = { id: 8, institute_id: 1, department_id: 2, section_id: 3, permissions: ['requests.reclassify'] };
    await reclassifyRequest({ requestId: 17, targetRequestType: 'Stock', actor, correlationId: 'route-v1' }, clientForVersion(1));
    await reclassifyRequest({ requestId: 17, targetRequestType: 'Stock', actor, correlationId: 'route-v2' }, clientForVersion(2));

    const first = approvalEngine.createSteps.mock.calls[0][0].routeSnapshot;
    const second = approvalEngine.createSteps.mock.calls[1][0].routeSnapshot;
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(outbox.enqueueNotification.mock.calls[0][1].idempotencyKey).not.toBe(outbox.enqueueNotification.mock.calls[1][1].idempotencyKey);
    expect(approvalEngine.createSteps.mock.calls[0][0].inheritedDecisions).toEqual([
      expect.objectContaining({ approver_id: 42, status: 'Approved' }),
    ]);

    for (const snapshot of [first, second]) {
      const { snapshotId, ...hashedSnapshot } = snapshot;
      expect(crypto.createHash('sha256').update(stable(hashedSnapshot)).digest('hex')).toBe(snapshotId);
      expect(approvalEngine.createSteps.mock.calls[snapshot.version - 1][0].routeSnapshot.snapshotId).toBe(snapshotId);
    }
  });
});

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}