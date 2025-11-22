const express = require('express');
const router = express.Router();
const {
  addWarehouseStock,
  getWeeklyDepartmentStockingReport,
} = require('../controllers/warehouseInventoryController');

router.post('/stock', addWarehouseStock);
router.get('/reports/weekly', getWeeklyDepartmentStockingReport);

module.exports = router;