'use strict';
const { compareDecimal } = require('./purchaseOrderTotalsService');
const deriveCompletion = ({ approvedQuantity, orderedQuantity, receivedQuantity, invoicedQuantity, paidAmount, payableAmount, financiallyActiveInvoiceCount, unsettledPayableCount = 0, activeCommitmentCount = 0, unresolvedFinancialObligationCount = 0 }) => ({
  procurement_complete: compareDecimal(orderedQuantity, approvedQuantity) >= 0,
  receipt_complete: compareDecimal(orderedQuantity, '0') > 0 && compareDecimal(receivedQuantity, orderedQuantity) >= 0,
  financial_complete: financiallyActiveInvoiceCount == null
    ? compareDecimal(invoicedQuantity, orderedQuantity) >= 0 && compareDecimal(payableAmount, '0') > 0 && compareDecimal(paidAmount, payableAmount) >= 0
    : Number(financiallyActiveInvoiceCount) > 0 && Number(unsettledPayableCount) === 0 && Number(activeCommitmentCount) === 0 && Number(unresolvedFinancialObligationCount) === 0,
});
module.exports = { deriveCompletion };