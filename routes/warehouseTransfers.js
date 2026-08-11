const express = require('express');
const router = express.Router();
const {
  approveTransferRequest,
  createTransferRequest,
  getTransferRequest,
  rejectTransferRequest,
  receiveTransferRequest,
  cancelTransferRequest,
} = require('../controllers/warehouseTransfersController');

router.post('/', createTransferRequest);
router.get('/:transferId', getTransferRequest);
router.post('/:transferId/approve', approveTransferRequest);
router.post('/:transferId/reject', rejectTransferRequest);
router.post('/:transferId/receive', receiveTransferRequest);
router.post('/:transferId/cancel', cancelTransferRequest);

module.exports = router;