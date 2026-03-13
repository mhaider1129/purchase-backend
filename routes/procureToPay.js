const express = require('express');
const router = express.Router();

const {
  getLifecycleDetail,
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  postPayableFromInvoice,
  listAccountsPayable,
  recordPayablePayment,
  getDocumentFlow,
  createApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
} = require('../controllers/procureToPayController');

router.get('/requests/:requestId/lifecycle', getLifecycleDetail);
router.post('/requests/:requestId/purchase-orders', createPurchaseOrder);
router.get('/purchase-orders', listPurchaseOrders);
router.get('/purchase-orders/:poId', getPurchaseOrderDetail);
router.post('/requests/:requestId/receipts', createGoodsReceipt);
router.get('/requests/:requestId/receipts', listReceiptsByRequest);
router.post('/requests/:requestId/invoices', submitInvoice);
router.post('/requests/:requestId/invoices/:invoiceId/match', runInvoiceMatch);
router.post('/requests/:requestId/match-results/:matchResultId/override', approveMatchOverride);
router.post('/ap-invoices/:invoiceId/post-payable', postPayableFromInvoice);
router.get('/accounts-payable', listAccountsPayable);
router.post('/accounts-payable/:payableId/payments', recordPayablePayment);
router.get('/document-flow/request/:requestId', getDocumentFlow);
router.post('/requests/:requestId/vouchers', createApVoucher);
router.post('/requests/:requestId/verify', verifyFinanceRecord);
router.post('/requests/:requestId/post-ledger', postToInternalLedger);
router.post('/requests/:requestId/payment-pending', markPaymentPending);
router.post('/requests/:requestId/payments/:paymentId/paid', markPaid);

module.exports = router;