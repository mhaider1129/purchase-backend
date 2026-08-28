'use strict';
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn(), buildApprovalActionLinks: jest.fn(() => ({ approveUrl: 'a', rejectUrl: 'r' })) }));
jest.mock('../controllers/requests/createRequestController', () => ({ assignApprover: jest.fn() }));
jest.mock('../services/requestAutoAssignmentService', () => ({ applyAutoAssignmentForApprovedRequest: jest.fn(async () => null) }));
const { sendEmail } = require('../utils/emailService');
const { applyAutoAssignmentForApprovedRequest } = require('../services/requestAutoAssignmentService');
const { continueApprovalWorkflowAfterLevel } = require('../services/approvalContinuationService');
const request = { id: 10, request_type: 'Purchase', requester_id: 4, requester_email: 'requester@test', department_id: 2 };
const approval = { id: 8, request_id: 10, approval_level: 2 };
function clientFor({ pending = 0, next = [], incomplete = false, transition = true } = {}) {
  return { query: jest.fn(async sql => {
    if (sql.includes('COUNT(*) AS pending_count')) return { rows: [{ pending_count: pending }] };
    if (sql.includes('UPDATE approvals SET is_active=TRUE')) return { rowCount: next.length, rows: next };
    if (sql.includes("status<>'Approved'")) return { rowCount: incomplete ? 1 : 0, rows: incomplete ? [{}] : [] };
    if (sql.includes("UPDATE requests SET status='Approved'")) return { rowCount: transition ? 1 : 0, rows: transition ? [request] : [] };
    if (sql.includes("role='SCM'")) return { rows: [] };
    if (sql.startsWith('SELECT email FROM users')) return { rows: [{ email: 'next@test' }] };
    return { rowCount: 1, rows: [] };
  }) };
}
beforeEach(() => jest.clearAllMocks());
test('parallel approvals wait without activation or downstream effects', async () => {
  const client = clientFor({ pending: 1 });
  await expect(continueApprovalWorkflowAfterLevel({ client, request, approval, actorId: 5 })).resolves.toMatchObject({ state: 'LEVEL_PENDING' });
  expect(client.query).toHaveBeenCalledTimes(1); expect(sendEmail).not.toHaveBeenCalled();
});
test('a completed normal level activates every member of the next level once', async () => {
  const next = [{ id: 11, approver_id: 6, approval_level: 3 }, { id: 12, approver_id: 7, approval_level: 3 }];
  const notifications = []; const result = await continueApprovalWorkflowAfterLevel({ client: clientFor({ next }), request, approval, actorId: 5, enqueueNotification: x => notifications.push(x) });
  expect(result).toMatchObject({ state: 'NEXT_LEVEL_ACTIVE', nextApprovals: next }); expect(notifications).toHaveLength(2);
});
test('retry with next level already active creates no notification or assignment', async () => {
  const notify = jest.fn(); const result = await continueApprovalWorkflowAfterLevel({ client: clientFor({ incomplete: true }), request, approval, actorId: 5, enqueueNotification: notify });
  expect(result.state).toBe('ALREADY_CONTINUED'); expect(notify).not.toHaveBeenCalled(); expect(applyAutoAssignmentForApprovedRequest).not.toHaveBeenCalled();
});
test('final approval transition performs final side effects exactly once', async () => {
  const notify = jest.fn(); const result = await continueApprovalWorkflowAfterLevel({ client: clientFor(), request: { ...request }, approval, actorId: 5, enqueueNotification: notify });
  expect(result).toMatchObject({ state: 'FINAL_APPROVED', changed: true }); expect(applyAutoAssignmentForApprovedRequest).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledTimes(1);
});
test('retry after final approval has no duplicate downstream effects', async () => {
  const client = clientFor({ transition: false }); const notify = jest.fn(); const result = await continueApprovalWorkflowAfterLevel({ client, request, approval, actorId: 5, enqueueNotification: notify });
  expect(result).toMatchObject({ state: 'FINAL_APPROVED', changed: false }); expect(notify).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled(); expect(applyAutoAssignmentForApprovedRequest).not.toHaveBeenCalled(); expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO request_logs'))).toBe(false);
});