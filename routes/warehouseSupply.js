const express = require('express');
const router = express.Router();
const {
  recordSuppliedItems,
  getWarehouseSupplyRequests,
} = require('../controllers/warehouseSupplyController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/', authenticateUser, getWarehouseSupplyRequests);
router.post('/:requestId/items', authenticateUser, recordSuppliedItems);

module.exports = router;