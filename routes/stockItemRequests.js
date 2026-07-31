const express = require('express');
const router = express.Router();
const requireLegacyCreation = require('../middleware/legacyStockItemCreation');
const requirePermission = require('../middleware/requirePermission');
const {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
} = require('../controllers/stockItemRequestsController');

router.post('/', requirePermission('stock-requests.create'), createStockItemRequest);
router.get('/', getStockItemRequests);
router.patch(
  '/:id/status',
  requirePermission('stock-requests.review'),
  requireLegacyCreation,
  updateStockItemRequestStatus,
);

module.exports = router;