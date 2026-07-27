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
router.post('/add-from-master', identity.requirePermission('inventory.add-from-master'), identity.add);
router.post('/mappings/apply', identity.requirePermission('item-master.stock-map'), identity.map);

router.post('/assign-warehouses', assignStockItemToWarehouses);

module.exports = router;