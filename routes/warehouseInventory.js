const express = require('express');
const router = express.Router();
const {
  addWarehouseStock,
  getWeeklyDepartmentStockingReport,
  issueWarehouseStock,
  getWarehouseItems,
} = require('../controllers/warehouseInventoryController');

router.post('/stock', addWarehouseStock);
router.post('/stock/issue', issueWarehouseStock);
router.get('/reports/weekly', getWeeklyDepartmentStockingReport);
router.get('/:warehouseId/items', getWarehouseItems);

module.exports = router;