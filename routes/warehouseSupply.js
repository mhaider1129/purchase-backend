const express = require('express');
const router = express.Router();
const {
  recordSuppliedItems,
  getWarehouseSupplyRequests,
  closeWarehouseSupplyRequest,
  printWarehouseSupplyRequest,
} = require('../controllers/warehouseSupplyController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/', authenticateUser, getWarehouseSupplyRequests);
router.post('/:requestId/items', authenticateUser, recordSuppliedItems);
router.post('/:requestId/close', authenticateUser, closeWarehouseSupplyRequest);
router.get('/:id/print', authenticateUser, printWarehouseSupplyRequest);

module.exports = router;