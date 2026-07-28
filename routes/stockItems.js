const express = require('express');
const router = express.Router();
const {
  assignStockItemToWarehouses,
  getStockItems,
  getUnassignedStockItems,
} = require('../controllers/stockItemsController');

router.get('/', getStockItems);
router.get('/unassigned', getUnassignedStockItems);
const identity = require('../controllers/stockItemIdentityController');
const requirePermission = require('../middleware/requirePermission');
const {
  validateAddToInventory,
  validateApplyMapping,
} = require('../middleware/stockItemIdentityValidation');

router.post(
  '/add-from-master',
  requirePermission('inventory.add-from-master'),
  validateAddToInventory,
  identity.add
);
router.post(
  '/mappings/apply',
  requirePermission('item-master.stock-map'),
  validateApplyMapping,
  identity.map
);

router.post('/assign-warehouses', assignStockItemToWarehouses);

module.exports = router;