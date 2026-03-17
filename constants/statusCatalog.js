const REQUEST_STATUS = Object.freeze({
  SUBMITTED: 'Submitted',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RECEIVED: 'Received',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
});

const APPROVAL_STATUS = Object.freeze({
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  HOLD: 'Hold',
});

const PAYABLE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'payment_pending',
  PAID: 'paid',
});

const INVOICE_MATCH_STATUS = Object.freeze({
  PENDING: 'PENDING_MATCH',
  VERIFIED: 'MATCHED',
  EXCEPTION: 'EXCEPTION',
  OVERRIDDEN: 'OVERRIDDEN',
});

module.exports = {
  REQUEST_STATUS,
  APPROVAL_STATUS,
  PAYABLE_STATUS,
  PAYMENT_STATUS,
  INVOICE_MATCH_STATUS,
};