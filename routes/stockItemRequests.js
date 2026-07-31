const express = require('express');
const router = express.Router();
const requireLegacyCreation = require('../middleware/legacyStockItemCreation');
const {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
} = require('../controllers/stockItemRequestsController');

router.post('/', createStockItemRequest);
router.get('/', getStockItemRequests);
router.patch('/:id/status', requireLegacyCreation, updateStockItemRequestStatus);

module.exports = router;