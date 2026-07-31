const { createRequestTransitionService, StatusTransitionError } = require('../domain/statusTransitionService');
const { ENTITY_TYPES } = require('../domain/statusConstants');
const { validateLifecycleCommand } = require('../validators/requestLifecycleValidator');
const { validateApprovalDecision } = require('../validators/approvalDecisionValidator');

describe('Phase 2 lifecycle domain', () => {
  const service = createRequestTransitionService();
  test('valid submission', () => expect(service.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: 'Draft', nextState: 'Submitted' }).to).toBe('Submitted'));
  test('compatibility alias maps under approval to Pending', () => expect(service.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: 'Submitted', nextState: 'Under Approval' }).to).toBe('Pending'));
  test('invalid submission transition is rejected', () => expect(() => service.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: 'Approved', nextState: 'Submitted' })).toThrow(StatusTransitionError));
  test.each(['Rejected', 'Returned for Correction', 'Cancelled', 'Withdrawn'])('%s requires a reason', status => expect(() => validateLifecycleCommand({ requestId: 1, toStatus: status })).toThrow(expect.objectContaining({ code: 'REASON_REQUIRED' })));
  test('cancellation with reason validates', () => expect(validateLifecycleCommand({ requestId: 1, toStatus: 'Cancelled', reason: 'No longer needed' }).reason).toBe('No longer needed'));
  test('duplicate submission can be idempotent', () => expect(service.validate({ entityType: ENTITY_TYPES.REQUEST, currentState: 'Submitted', nextState: 'Submitted', allowIdempotent: true }).idempotent).toBe(true));
  test('approval rejection requires reason', () => expect(() => validateApprovalDecision({ approvalId: 2, decision: 'reject' })).toThrow(expect.objectContaining({ code: 'REASON_REQUIRED' })));
});