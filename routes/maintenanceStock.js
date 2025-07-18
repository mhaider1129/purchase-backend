const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  getStockItems,
  upsertStockItem,
} = require('../controllers/maintenanceStockController');

router.get('/', authenticateUser, getStockItems);
router.post('/', authenticateUser, upsertStockItem);
router.put('/:id', authenticateUser, upsertStockItem);

module.exports = router;