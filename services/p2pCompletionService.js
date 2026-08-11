'use strict';
const deriveCompletion = ({ approvedQuantity, orderedQuantity, receivedQuantity, invoicedQuantity, paidAmount, payableAmount }) => ({
  procurement_complete: Number(orderedQuantity) >= Number(approvedQuantity),
  receipt_complete: Number(receivedQuantity) >= Number(orderedQuantity) && Number(orderedQuantity) > 0,
  financial_complete: Number(invoicedQuantity) >= Number(orderedQuantity) && Number(paidAmount) >= Number(payableAmount) && Number(payableAmount) > 0,
});
module.exports = { deriveCompletion };