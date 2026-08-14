const express = require('express');
const {
  listItems,
  getItemById,
  createItem,
  updateItem,
  submitForApproval,
  approveItem,
  rejectItem,
  addDocument,
} = require('../controllers/itemMasterController');

const router = express.Router();
const foundation = require('../controllers/itemMasterFoundationController');

// Migration-owned normalized hierarchy. Keep above `/:id` so Express does not
// interpret "foundation" or "reference" as a legacy numeric identifier.
router.get('/foundation/generic-items', foundation.requirePermission('item-master.view'), foundation.searchGeneric);
router.get('/foundation/references', foundation.requirePermission('item-master.view'), foundation.referenceData);
router.get('/foundation/references/:type', foundation.requirePermission('item-master.view'), foundation.searchReferences);
router.post('/foundation/references/:type', foundation.requirePermission('item-master.references-maintain'), foundation.createReference);
router.delete('/foundation/references/:type/:id', foundation.requirePermission('item-master.references-maintain'), foundation.deactivateReference);
router.post('/foundation/generic-items', foundation.requirePermission('item-master.create'), foundation.createGeneric);
router.post('/foundation/generic-items/:id/transition', foundation.requireTransitionPermission, foundation.transitionGeneric);
router.get('/foundation/products', foundation.requirePermission('item-master.view'), foundation.searchProducts);
router.post('/foundation/products', foundation.requirePermission('item-master.products'), foundation.createProduct);
router.post('/foundation/products/:id/approve', foundation.requirePermission('item-master.products.approve'), foundation.approveProduct);
router.post('/foundation/products/:id/decision', foundation.requirePermission('item-master.products.approve'), foundation.transitionProduct);
router.get('/foundation/supplier-catalog', foundation.requirePermission('item-master.view'), foundation.searchCatalog);
router.post('/foundation/supplier-catalog', foundation.requirePermission('item-master.suppliers'), foundation.createCatalog);
router.put('/foundation/supplier-catalog/:id', foundation.requirePermission('item-master.suppliers'), foundation.updateCatalog);
router.delete('/foundation/supplier-catalog/:id', foundation.requirePermission('item-master.suppliers'), foundation.deactivateCatalog);
router.post('/foundation/pending-items', foundation.requireAnyPermission(['stock-requests.create','requests.manage','item-master.create']), foundation.submitPending);
router.get('/foundation/pending-items', foundation.requirePermission('item-master.map'), foundation.pendingQueue);
router.post('/foundation/pending-items/:id/resolve', foundation.requirePermission('item-master.map'), foundation.resolvePending);
router.post('/foundation/duplicates/:id/resolve', foundation.requirePermission('item-master.map'), foundation.resolveDuplicate);
router.post('/foundation/merges', foundation.requirePermission('item-master.map'), foundation.requestMerge);
router.get('/foundation/legacy/coverage', foundation.requirePermission('item-master.legacy-maintain'), foundation.legacyCoverage);
router.get('/foundation/legacy/unmapped', foundation.requirePermission('item-master.legacy-maintain'), foundation.unmappedLegacy);
router.post('/foundation/legacy/mappings', foundation.requirePermission('item-master.legacy-maintain'), foundation.mapLegacy);

router.get('/', listItems);
router.get('/:id', getItemById);
router.post('/', createItem);
router.put('/:id', updateItem);
router.post('/:id/submit', submitForApproval);
router.post('/:id/approve', approveItem);
router.post('/:id/reject', rejectItem);
router.post('/:id/documents', addDocument);

module.exports = router;