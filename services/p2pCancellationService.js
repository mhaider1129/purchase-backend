'use strict';
const planCancellation = ({ entityType, receivedQuantity = 0, paidAmount = 0 }) => {
  if (entityType === 'INVOICE' && Number(paidAmount) > 0) return { allowed: false, code: 'FINANCIAL_REVERSAL_REQUIRED' };
  if (entityType === 'PURCHASE_ORDER' && Number(receivedQuantity) > 0) return { allowed: false, code: 'RECEIPT_RETURN_OR_REVERSAL_REQUIRED', preserve_history: true };
  return { allowed: true, release_commitment: entityType === 'PURCHASE_ORDER', preserve_history: true };
};
module.exports = { planCancellation };