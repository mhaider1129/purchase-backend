const express = require('express');
const {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSuppliersDashboard,
} = require('../controllers/suppliersController');
const {
  getSupplierProfile,
  updateSupplierClassification,
  listSupplierPrincipals,
  createSupplierPrincipal,
  updateSupplierPrincipal,
  deleteSupplierPrincipal,
  verifySupplierPrincipal,
  suspendSupplierPrincipal,
} = require('../controllers/supplierPrincipalsController');

const router = express.Router();

router.get('/', listSuppliers);
router.get('/dashboard', getSuppliersDashboard);
router.get('/:id/profile', getSupplierProfile);
router.patch('/:id/classification', updateSupplierClassification);
router.get('/:id/principals', listSupplierPrincipals);
router.post('/:id/principals', createSupplierPrincipal);
router.patch('/:id/principals/:principalId/verify', verifySupplierPrincipal);
router.patch('/:id/principals/:principalId/suspend', suspendSupplierPrincipal);
router.patch('/:id/principals/:principalId', updateSupplierPrincipal);
router.delete('/:id/principals/:principalId', deleteSupplierPrincipal);
router.post('/', createSupplier);
router.patch('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

module.exports = router;