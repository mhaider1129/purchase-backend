const express = require('express');
const router = express.Router();
const {
  assignStockItemToWarehouses,
  getStockItems,
  getUnassignedStockItems,
} = require('../controllers/stockItemsController');

router.get('/', getStockItems);
router.get('/unassigned', getUnassignedStockItems);
router.post('/assign-warehouses', assignStockItemToWarehouses);

module.exports = router;