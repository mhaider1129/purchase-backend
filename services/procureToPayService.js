const LIFECYCLE_STATES = Object.freeze({
  DRAFT_PR: 'DRAFT_PR',
  SUBMITTED_PR: 'SUBMITTED_PR',
  UNDER_APPROVAL: 'UNDER_APPROVAL',
  APPROVED_PR: 'APPROVED_PR',
  PO_DRAFT: 'PO_DRAFT',
  PO_ISSUED: 'PO_ISSUED',
  PO_PARTIALLY_RECEIVED: 'PO_PARTIALLY_RECEIVED',
  PO_FULLY_RECEIVED: 'PO_FULLY_RECEIVED',
  AP_INVOICE_DRAFT: 'AP_INVOICE_DRAFT',
  AP_INVOICE_SUBMITTED: 'AP_INVOICE_SUBMITTED',
  MATCH_PENDING: 'MATCH_PENDING',
  MATCH_EXCEPTION: 'MATCH_EXCEPTION',
  MATCH_VERIFIED: 'MATCH_VERIFIED',
  AP_POSTED: 'AP_POSTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
});

const MATCH_POLICIES = Object.freeze({
  TWO_WAY: 'TWO_WAY',
  THREE_WAY: 'THREE_WAY',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [LIFECYCLE_STATES.DRAFT_PR]: [LIFECYCLE_STATES.SUBMITTED_PR, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.SUBMITTED_PR]: [LIFECYCLE_STATES.UNDER_APPROVAL, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.UNDER_APPROVAL]: [LIFECYCLE_STATES.APPROVED_PR, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.APPROVED_PR]: [LIFECYCLE_STATES.PO_DRAFT, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.PO_DRAFT]: [LIFECYCLE_STATES.PO_ISSUED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.PO_ISSUED]: [LIFECYCLE_STATES.PO_PARTIALLY_RECEIVED, LIFECYCLE_STATES.PO_FULLY_RECEIVED, LIFECYCLE_STATES.AP_INVOICE_DRAFT],
  [LIFECYCLE_STATES.PO_PARTIALLY_RECEIVED]: [LIFECYCLE_STATES.PO_FULLY_RECEIVED, LIFECYCLE_STATES.AP_INVOICE_DRAFT],
  [LIFECYCLE_STATES.PO_FULLY_RECEIVED]: [LIFECYCLE_STATES.AP_INVOICE_DRAFT],
  [LIFECYCLE_STATES.AP_INVOICE_DRAFT]: [LIFECYCLE_STATES.AP_INVOICE_SUBMITTED],
  [LIFECYCLE_STATES.AP_INVOICE_SUBMITTED]: [LIFECYCLE_STATES.MATCH_PENDING],
  [LIFECYCLE_STATES.MATCH_PENDING]: [LIFECYCLE_STATES.MATCH_VERIFIED, LIFECYCLE_STATES.MATCH_EXCEPTION],
  [LIFECYCLE_STATES.MATCH_EXCEPTION]: [LIFECYCLE_STATES.MATCH_VERIFIED],
  [LIFECYCLE_STATES.MATCH_VERIFIED]: [LIFECYCLE_STATES.AP_POSTED],
  [LIFECYCLE_STATES.AP_POSTED]: [LIFECYCLE_STATES.PAYMENT_PENDING],
  [LIFECYCLE_STATES.PAYMENT_PENDING]: [LIFECYCLE_STATES.PARTIALLY_PAID, LIFECYCLE_STATES.PAID],
  [LIFECYCLE_STATES.PARTIALLY_PAID]: [LIFECYCLE_STATES.PAID],
  [LIFECYCLE_STATES.PAID]: [LIFECYCLE_STATES.CLOSED],
});

const normalizeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
};

const summarizeItems = (items = []) =>
  items.reduce(
    (acc, item) => {
      acc.quantity += normalizeNumber(item.quantity);
      acc.total += normalizeNumber(item.quantity) * normalizeNumber(item.unit_price ?? item.unit_cost);
      return acc;
    },
    { quantity: 0, total: 0 }
  );

const performInvoiceMatch = ({ policy = MATCH_POLICIES.THREE_WAY, requestItems = [], receiptItems = [], invoiceItems = [] }) => {
  const requestSummary = summarizeItems(requestItems);
  const receiptSummary = summarizeItems(receiptItems);
  const invoiceSummary = summarizeItems(invoiceItems);

  const mismatches = [];

  if (invoiceSummary.quantity > requestSummary.quantity) {
    mismatches.push('Invoice quantity exceeds requested quantity');
  }

  if (invoiceSummary.total > requestSummary.total) {
    mismatches.push('Invoice total exceeds requested/PO total');
  }

  if (policy === MATCH_POLICIES.THREE_WAY) {
    if (invoiceSummary.quantity > receiptSummary.quantity) {
      mismatches.push('Invoice quantity exceeds received quantity');
    }

    if (invoiceSummary.total > receiptSummary.total && receiptSummary.total > 0) {
      mismatches.push('Invoice total exceeds received value');
    }
  }

  return {
    policy,
    matched: mismatches.length === 0,
    mismatch_reasons: mismatches,
    request_summary: requestSummary,
    receipt_summary: receiptSummary,
    invoice_summary: invoiceSummary,
  };
};

const canTransitionState = (fromState, toState) => {
  if (!fromState) {
    return toState === LIFECYCLE_STATES.DRAFT_PR;
  }

  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  return allowed.includes(toState);
};

module.exports = {
  LIFECYCLE_STATES,
  MATCH_POLICIES,
  ALLOWED_TRANSITIONS,
  performInvoiceMatch,
  canTransitionState,
};