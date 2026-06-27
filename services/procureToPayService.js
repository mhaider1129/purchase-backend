const LIFECYCLE_STATES = Object.freeze({
  DRAFT_PR: 'DRAFT_PR',
  SUBMITTED_PR: 'SUBMITTED_PR',
  UNDER_APPROVAL: 'UNDER_APPROVAL',
  APPROVED_PR: 'APPROVED_PR',
  PO_DRAFT: 'PO_DRAFT',
  PO_PENDING_APPROVAL: 'PO_PENDING_APPROVAL',
  PO_APPROVED: 'PO_APPROVED',
  PO_ISSUED: 'PO_ISSUED',
  PO_PARTIAL: 'PO_PARTIAL',
  PO_DELIVERED: 'PO_DELIVERED',
  PO_CLOSED: 'PO_CLOSED',
  PO_CANCELLED: 'PO_CANCELLED',
  AP_INVOICE_DRAFT: 'AP_INVOICE_DRAFT',
  AP_INVOICE_SUBMITTED: 'AP_INVOICE_SUBMITTED',
  MATCH_PENDING: 'MATCH_PENDING',
  MATCH_EXCEPTION: 'MATCH_EXCEPTION',
  MATCH_VERIFIED: 'MATCH_VERIFIED',
  FINANCE_REVIEW_PENDING: 'FINANCE_REVIEW_PENDING',
  FINANCE_VERIFIED: 'FINANCE_VERIFIED',
  AP_VOUCHER_CREATED: 'AP_VOUCHER_CREATED',
  AP_POSTED: 'AP_POSTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
});

const PURCHASE_ORDER_STATUS_MAP = Object.freeze({
  PO_DRAFT: { business_status: 'Draft', system_code: 'PO_DRAFT', lifecycle_state: LIFECYCLE_STATES.PO_DRAFT },
  PO_PENDING_APPROVAL: { business_status: 'Pending Approval', system_code: 'PO_PENDING_APPROVAL', lifecycle_state: LIFECYCLE_STATES.PO_PENDING_APPROVAL },
  PO_APPROVED: { business_status: 'Approved', system_code: 'PO_APPROVED', lifecycle_state: LIFECYCLE_STATES.PO_APPROVED },
  PO_ISSUED: { business_status: 'Issued / Sent to Supplier', system_code: 'PO_ISSUED', lifecycle_state: LIFECYCLE_STATES.PO_ISSUED },
  PO_PARTIAL: { business_status: 'Partially Received', system_code: 'PO_PARTIAL', lifecycle_state: LIFECYCLE_STATES.PO_PARTIAL },
  PO_DELIVERED: { business_status: 'Fully Received', system_code: 'PO_DELIVERED', lifecycle_state: LIFECYCLE_STATES.PO_DELIVERED },
  PO_CLOSED: { business_status: 'Closed', system_code: 'PO_CLOSED', lifecycle_state: LIFECYCLE_STATES.PO_CLOSED },
  PO_CANCELLED: { business_status: 'Cancelled', system_code: 'PO_CANCELLED', lifecycle_state: LIFECYCLE_STATES.PO_CANCELLED },
});

const MATCH_POLICIES = Object.freeze({
  TWO_WAY: 'TWO_WAY',
  THREE_WAY: 'THREE_WAY',
});

const DEFAULT_MATCH_TOLERANCES = Object.freeze({
  quantity: 0,
  amount: 0,
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [LIFECYCLE_STATES.DRAFT_PR]: [LIFECYCLE_STATES.SUBMITTED_PR, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.SUBMITTED_PR]: [LIFECYCLE_STATES.UNDER_APPROVAL, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.UNDER_APPROVAL]: [LIFECYCLE_STATES.APPROVED_PR, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.APPROVED_PR]: [LIFECYCLE_STATES.PO_DRAFT, LIFECYCLE_STATES.PO_PENDING_APPROVAL, LIFECYCLE_STATES.PO_APPROVED, LIFECYCLE_STATES.PO_ISSUED, LIFECYCLE_STATES.CANCELLED],
  [LIFECYCLE_STATES.PO_DRAFT]: [LIFECYCLE_STATES.PO_PENDING_APPROVAL, LIFECYCLE_STATES.PO_APPROVED, LIFECYCLE_STATES.PO_ISSUED, LIFECYCLE_STATES.PO_CANCELLED],
  [LIFECYCLE_STATES.PO_PENDING_APPROVAL]: [LIFECYCLE_STATES.PO_APPROVED, LIFECYCLE_STATES.PO_CANCELLED],
  [LIFECYCLE_STATES.PO_APPROVED]: [LIFECYCLE_STATES.PO_ISSUED, LIFECYCLE_STATES.PO_CANCELLED],
  [LIFECYCLE_STATES.PO_ISSUED]: [LIFECYCLE_STATES.PO_PARTIAL, LIFECYCLE_STATES.PO_DELIVERED, LIFECYCLE_STATES.AP_INVOICE_DRAFT, LIFECYCLE_STATES.PO_CLOSED, LIFECYCLE_STATES.PO_CANCELLED],
  [LIFECYCLE_STATES.PO_PARTIAL]: [LIFECYCLE_STATES.PO_DELIVERED, LIFECYCLE_STATES.AP_INVOICE_DRAFT, LIFECYCLE_STATES.PO_CLOSED, LIFECYCLE_STATES.PO_CANCELLED],
  [LIFECYCLE_STATES.PO_DELIVERED]: [LIFECYCLE_STATES.AP_INVOICE_DRAFT, LIFECYCLE_STATES.PO_CLOSED],
  [LIFECYCLE_STATES.AP_INVOICE_DRAFT]: [LIFECYCLE_STATES.AP_INVOICE_SUBMITTED],
  [LIFECYCLE_STATES.AP_INVOICE_SUBMITTED]: [LIFECYCLE_STATES.MATCH_PENDING],
  [LIFECYCLE_STATES.MATCH_PENDING]: [LIFECYCLE_STATES.MATCH_VERIFIED, LIFECYCLE_STATES.MATCH_EXCEPTION, LIFECYCLE_STATES.FINANCE_REVIEW_PENDING],
  [LIFECYCLE_STATES.MATCH_EXCEPTION]: [LIFECYCLE_STATES.MATCH_VERIFIED, LIFECYCLE_STATES.FINANCE_REVIEW_PENDING],
  [LIFECYCLE_STATES.MATCH_VERIFIED]: [LIFECYCLE_STATES.FINANCE_REVIEW_PENDING, LIFECYCLE_STATES.FINANCE_VERIFIED],
  [LIFECYCLE_STATES.FINANCE_REVIEW_PENDING]: [LIFECYCLE_STATES.FINANCE_VERIFIED],
  [LIFECYCLE_STATES.FINANCE_VERIFIED]: [LIFECYCLE_STATES.AP_VOUCHER_CREATED, LIFECYCLE_STATES.AP_POSTED],
  [LIFECYCLE_STATES.AP_VOUCHER_CREATED]: [LIFECYCLE_STATES.AP_POSTED],
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

const withinTolerance = (actual, expected, tolerance = 0) => actual <= expected + Math.max(Number(tolerance) || 0, 0);

const performInvoiceMatch = ({
  policy = MATCH_POLICIES.THREE_WAY,
  requestItems = [],
  purchaseOrderItems = [],
  receiptItems = [],
  invoiceItems = [],
  tolerances = DEFAULT_MATCH_TOLERANCES,
}) => {
  const requestSummary = summarizeItems(requestItems);
  const purchaseOrderSummary = summarizeItems(purchaseOrderItems);
  const receiptSummary = summarizeItems(receiptItems);
  const invoiceSummary = summarizeItems(invoiceItems);
  const commercialBaseline = purchaseOrderSummary.quantity > 0 ? purchaseOrderSummary : requestSummary;
  const commercialBaselineLabel = purchaseOrderSummary.quantity > 0 ? 'PO' : 'requested';
  const commercialBaselineTotal = normalizeNumber(commercialBaseline.total);
  const invoiceTotal = normalizeNumber(invoiceSummary.total);
  const discountAmount = Math.max(commercialBaselineTotal - invoiceTotal, 0);
  const overageAmount = Math.max(invoiceTotal - commercialBaselineTotal, 0);
  const quantityTolerance = tolerances.quantity ?? DEFAULT_MATCH_TOLERANCES.quantity;
  const amountTolerance = tolerances.amount ?? DEFAULT_MATCH_TOLERANCES.amount;

  const mismatches = [];

  if (!withinTolerance(invoiceSummary.quantity, commercialBaseline.quantity, quantityTolerance)) {
    mismatches.push(`Invoice quantity exceeds ${commercialBaselineLabel} quantity`);
  }

  if (!withinTolerance(invoiceSummary.total, commercialBaseline.total, amountTolerance)) {
    mismatches.push('Invoice total exceeds requested/PO total');
  }

  if (policy === MATCH_POLICIES.THREE_WAY) {
    if (!withinTolerance(invoiceSummary.quantity, receiptSummary.quantity, quantityTolerance)) {
      mismatches.push('Invoice quantity exceeds received quantity');
    }

    if (receiptSummary.total > 0 && !withinTolerance(invoiceSummary.total, receiptSummary.total, amountTolerance)) {
      mismatches.push('Invoice total exceeds received value');
    }
  }

  return {
    policy,
    matched: mismatches.length === 0,
    mismatch_reasons: mismatches,
    request_summary: requestSummary,
    purchase_order_summary: purchaseOrderSummary,
    receipt_summary: receiptSummary,
    invoice_summary: invoiceSummary,
    match_basis: purchaseOrderSummary.quantity > 0 ? 'PURCHASE_ORDER' : 'PURCHASE_REQUEST',
    price_variance: {
      discount_amount: discountAmount,
      overage_amount: overageAmount,
      is_supplier_discount: mismatches.length === 0 && discountAmount > 0,
      requires_supplier_discussion: overageAmount > (Number(amountTolerance) || 0),
    },
    tolerances: { quantity: Number(quantityTolerance) || 0, amount: Number(amountTolerance) || 0 },
  };
};

const canTransitionState = (fromState, toState) => {
  if (!fromState) {
    return toState === LIFECYCLE_STATES.DRAFT_PR;
  }

  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  return allowed.includes(toState);
};

const getPurchaseOrderStatusMetadata = (status) => PURCHASE_ORDER_STATUS_MAP[status] || null;

const derivePurchaseOrderStatus = ({
  currentStatus = null,
  orderedQuantity = 0,
  receivedQuantity = 0,
  approvedAt = null,
  issuedAt = null,
  cancelledAt = null,
  closedAt = null,
} = {}) => {
  if (closedAt || currentStatus === 'PO_CLOSED') {
    return 'PO_CLOSED';
  }
  if (cancelledAt || currentStatus === 'PO_CANCELLED') {
    return 'PO_CANCELLED';
  }

  const ordered = normalizeNumber(orderedQuantity);
  const received = normalizeNumber(receivedQuantity);

  if (issuedAt || currentStatus === 'PO_ISSUED' || currentStatus === 'PO_PARTIAL' || currentStatus === 'PO_DELIVERED') {
    if (ordered > 0 && received >= ordered) {
      return 'PO_DELIVERED';
    }
    if (received > 0) {
      return 'PO_PARTIAL';
    }
    return 'PO_ISSUED';
  }

  if (approvedAt || currentStatus === 'PO_APPROVED') {
    return 'PO_APPROVED';
  }

  if (currentStatus === 'PO_PENDING_APPROVAL') {
    return 'PO_PENDING_APPROVAL';
  }

  return currentStatus || 'PO_DRAFT';
};

const validatePurchaseOrderForIssuance = ({
  supplierId = null,
  supplierName = null,
  items = [],
  deliveryDate = null,
  deliveryLocation = null,
  budgetCostCenter = null,
  taxTerms = null,
  paymentTerms = null,
} = {}) => {
  const errors = [];

  if (!supplierId && !String(supplierName || '').trim()) {
    errors.push('Supplier is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('At least one PO item is required');
  }
  if (!deliveryDate) {
    errors.push('Delivery date is required');
  }
  if (!String(deliveryLocation || '').trim()) {
    errors.push('Delivery location is required');
  }
  if (!String(budgetCostCenter || '').trim()) {
    errors.push('Budget / cost center is required');
  }
  if (!String(taxTerms || '').trim()) {
    errors.push('Tax terms are required');
  }
  if (!String(paymentTerms || '').trim()) {
    errors.push('Payment terms are required');
  }

  return errors;
};

module.exports = {
  LIFECYCLE_STATES,
  PURCHASE_ORDER_STATUS_MAP,
  MATCH_POLICIES,
  DEFAULT_MATCH_TOLERANCES,
  ALLOWED_TRANSITIONS,
  performInvoiceMatch,
  canTransitionState,
  getPurchaseOrderStatusMetadata,
  derivePurchaseOrderStatus,
  validatePurchaseOrderForIssuance,
};