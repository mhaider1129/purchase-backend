const LIFECYCLE_STATES = Object.freeze({
  REQUEST_CREATED: 'REQUEST_CREATED',
  APPROVED: 'APPROVED',
  PROCUREMENT_ASSIGNED: 'PROCUREMENT_ASSIGNED',
  SOURCING_IN_PROGRESS: 'SOURCING_IN_PROGRESS',
  PO_EQUIVALENT_CREATED: 'PO_EQUIVALENT_CREATED',
  GOODS_RECEIVED: 'GOODS_RECEIVED',
  INVOICE_RECEIVED: 'INVOICE_RECEIVED',
  INVOICE_MATCH_PENDING: 'INVOICE_MATCH_PENDING',
  INVOICE_MATCHED: 'INVOICE_MATCHED',
  FINANCE_REVIEW_PENDING: 'FINANCE_REVIEW_PENDING',
  FINANCE_VERIFIED: 'FINANCE_VERIFIED',
  AP_VOUCHER_CREATED: 'AP_VOUCHER_CREATED',
  POSTED_TO_INTERNAL_LEDGER: 'POSTED_TO_INTERNAL_LEDGER',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
});

const MATCH_POLICIES = Object.freeze({
  TWO_WAY: 'TWO_WAY',
  THREE_WAY: 'THREE_WAY',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [LIFECYCLE_STATES.REQUEST_CREATED]: [LIFECYCLE_STATES.APPROVED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.APPROVED]: [LIFECYCLE_STATES.PROCUREMENT_ASSIGNED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.PROCUREMENT_ASSIGNED]: [LIFECYCLE_STATES.SOURCING_IN_PROGRESS, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.SOURCING_IN_PROGRESS]: [LIFECYCLE_STATES.PO_EQUIVALENT_CREATED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.PO_EQUIVALENT_CREATED]: [LIFECYCLE_STATES.GOODS_RECEIVED, LIFECYCLE_STATES.INVOICE_RECEIVED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.GOODS_RECEIVED]: [LIFECYCLE_STATES.INVOICE_RECEIVED, LIFECYCLE_STATES.INVOICE_MATCH_PENDING],
  [LIFECYCLE_STATES.INVOICE_RECEIVED]: [LIFECYCLE_STATES.INVOICE_MATCH_PENDING, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.INVOICE_MATCH_PENDING]: [LIFECYCLE_STATES.INVOICE_MATCHED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.INVOICE_MATCHED]: [LIFECYCLE_STATES.FINANCE_REVIEW_PENDING],
  [LIFECYCLE_STATES.FINANCE_REVIEW_PENDING]: [LIFECYCLE_STATES.FINANCE_VERIFIED],
  [LIFECYCLE_STATES.FINANCE_VERIFIED]: [LIFECYCLE_STATES.AP_VOUCHER_CREATED],
  [LIFECYCLE_STATES.AP_VOUCHER_CREATED]: [LIFECYCLE_STATES.POSTED_TO_INTERNAL_LEDGER],
  [LIFECYCLE_STATES.POSTED_TO_INTERNAL_LEDGER]: [LIFECYCLE_STATES.PAYMENT_PENDING],
  [LIFECYCLE_STATES.PAYMENT_PENDING]: [LIFECYCLE_STATES.PAID],
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
    return toState === LIFECYCLE_STATES.REQUEST_CREATED;
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