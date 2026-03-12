const express = require('express');
const router = express.Router();

const {
  getLifecycleDetail,
  createGoodsReceipt,
  listReceiptsByRequest,
  submitInvoice,
  runInvoiceMatch,
  approveMatchOverride,
  createApVoucher,
  verifyFinanceRecord,
  postToInternalLedger,
  markPaymentPending,
  markPaid,
} = require('../controllers/procureToPayController');

router.get('/requests/:requestId/lifecycle', getLifecycleDetail);
router.post('/requests/:requestId/receipts', createGoodsReceipt);
router.get('/requests/:requestId/receipts', listReceiptsByRequest);
router.post('/requests/:requestId/invoices', submitInvoice);
router.post('/requests/:requestId/invoices/:invoiceId/match', runInvoiceMatch);
router.post('/requests/:requestId/match-results/:matchResultId/override', approveMatchOverride);
router.post('/requests/:requestId/vouchers', createApVoucher);
router.post('/requests/:requestId/verify', verifyFinanceRecord);
router.post('/requests/:requestId/post-ledger', postToInternalLedger);
router.post('/requests/:requestId/payment-pending', markPaymentPending);
router.post('/requests/:requestId/payments/:paymentId/paid', markPaid);

module.exports = router;