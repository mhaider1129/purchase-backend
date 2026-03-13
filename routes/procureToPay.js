const express = require('express');
const router = express.Router();

const {
  getProcureToPayDashboard,
  getPoSourceRequests,
  getLifecycleDetail,
  createPurchaseOrder,
  listPurchaseOrders,
  listGoodsReceipts,
  listOpenPosForReceipt,
  listApInvoices,
  listInvoiceMatchingQueue,
  getPurchaseOrderDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  postPayableFromInvoice,
  listAccountsPayable,
  listPayments,
  recordPayablePayment,
  listDocumentFlow,
  getDocumentFlow,
  createApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
} = require('../controllers/procureToPayController');

router.get('/dashboard', getProcureToPayDashboard);
router.get('/purchase-orders', listPurchaseOrders);
router.get('/po-source-requests', getPoSourceRequests);
router.get('/purchase-orders/:poId', getPurchaseOrderDetail);
router.get('/goods-receipts', listGoodsReceipts);
router.get('/open-pos-for-receipt', listOpenPosForReceipt);
router.get('/ap-invoices', listApInvoices);
router.get('/invoice-matching-queue', listInvoiceMatchingQueue);
router.get('/accounts-payable', listAccountsPayable);
router.get('/payments', listPayments);
router.get('/document-flow', listDocumentFlow);

router.get('/requests/:requestId/lifecycle', getLifecycleDetail);
router.post('/requests/:requestId/purchase-orders', createPurchaseOrder);
router.post('/requests/:requestId/receipts', createGoodsReceipt);
router.get('/requests/:requestId/receipts', listReceiptsByRequest);
router.post('/requests/:requestId/invoices', submitInvoice);
router.post('/requests/:requestId/invoices/:invoiceId/match', runInvoiceMatch);
router.post('/requests/:requestId/match-results/:matchResultId/override', approveMatchOverride);
router.post('/ap-invoices/:invoiceId/post-payable', postPayableFromInvoice);
router.post('/accounts-payable/:payableId/payments', recordPayablePayment);
router.get('/document-flow/request/:requestId', getDocumentFlow);
router.post('/requests/:requestId/vouchers', createApVoucher);
router.post('/requests/:requestId/verify', verifyFinanceRecord);
router.post('/requests/:requestId/post-ledger', postToInternalLedger);
router.post('/requests/:requestId/payment-pending', markPaymentPending);
router.post('/requests/:requestId/payments/:paymentId/paid', markPaid);

module.exports = router;