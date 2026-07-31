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
const { validateAddToInventory } = require('../middleware/stockItemIdentityValidation');

router.post('/add-from-master', requirePermission('inventory.add-from-master'), validateAddToInventory, identity.add);
router.get('/mappings', requirePermission('item-master.stock-map'), identity.list);
router.get('/mapping-coverage', requirePermission('item-master.stock-map'), identity.coverage);
router.get('/mappings/:mappingId', requirePermission('item-master.stock-map'), identity.detail);
router.get('/:stockItemId/mappings', requirePermission('item-master.stock-map'), identity.history);
router.post('/mappings/propose', requirePermission('item-master.stock-map'), identity.propose);
router.post('/mappings/:mappingId/review', requirePermission('item-master.stock-map'), identity.review);
router.post('/mappings/:mappingId/approve', requirePermission('item-master.stock-map'), identity.approve);
router.post('/mappings/:mappingId/reject', requirePermission('item-master.stock-map'), identity.reject);
router.post('/mappings/:mappingId/mark-duplicate', requirePermission('item-master.stock-map'), identity.markDuplicate);
router.post('/mappings/:mappingId/mark-obsolete', requirePermission('item-master.stock-map'), identity.markObsolete);
router.post('/mappings/:mappingId/exclude', requirePermission('item-master.stock-map'), identity.exclude);
router.post('/:stockItemId/mappings/:mappingId/supersede', requirePermission('item-master.stock-map.override'), identity.supersede);
router.post('/:stockItemId/mappings/:mappingId/rollback', requirePermission('item-master.stock-map.override'), identity.rollback);

router.post('/assign-warehouses', assignStockItemToWarehouses);

module.exports = router;