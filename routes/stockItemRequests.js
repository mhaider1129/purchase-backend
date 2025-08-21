const express = require('express');
const router = express.Router();
const {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
} = require('../controllers/stockItemRequestsController');

router.post('/', createStockItemRequest);
router.get('/', getStockItemRequests);
router.patch('/:id/status', updateStockItemRequestStatus);

module.exports = router;