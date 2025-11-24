const express = require('express');
const router = express.Router();
const {
  addWarehouseStock,
  getWeeklyDepartmentStockingReport,
  getWarehouseItems,
} = require('../controllers/warehouseInventoryController');

router.post('/stock', addWarehouseStock);
router.get('/reports/weekly', getWeeklyDepartmentStockingReport);
router.get('/:warehouseId/items', getWarehouseItems);

module.exports = router;