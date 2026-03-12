const express = require('express');
const router = express.Router();
const {
  approveTransferRequest,
  createTransferRequest,
  getTransferRequest,
  rejectTransferRequest,
} = require('../controllers/warehouseTransfersController');

router.post('/', createTransferRequest);
router.get('/:transferId', getTransferRequest);
router.post('/:transferId/approve', approveTransferRequest);
router.post('/:transferId/reject', rejectTransferRequest);

module.exports = router;