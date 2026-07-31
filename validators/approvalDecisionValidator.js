const DECISIONS = Object.freeze({ APPROVE: 'Approved', REJECT: 'Rejected', RETURN: 'Returned' });

function validateApprovalDecision(input = {}) {
  const approvalId = Number(input.approvalId);
  if (!Number.isInteger(approvalId) || approvalId <= 0) throw Object.assign(new TypeError('approvalId must be a positive integer'), { code: 'INVALID_APPROVAL_ID' });
  const decision = DECISIONS[String(input.decision || '').trim().toUpperCase()] || String(input.decision || '').trim();
  if (!Object.values(DECISIONS).includes(decision)) throw Object.assign(new TypeError('decision must be Approved, Rejected, or Returned'), { code: 'INVALID_DECISION' });
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (decision !== DECISIONS.APPROVE && !reason) throw Object.assign(new TypeError('A reason is required'), { code: 'REASON_REQUIRED' });
  return { ...input, approvalId, decision, reason: reason || null };
}

module.exports = { validateApprovalDecision, DECISIONS };