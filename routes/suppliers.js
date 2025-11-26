const express = require('express');
const {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} = require('../controllers/suppliersController');

const router = express.Router();

router.get('/', listSuppliers);
router.post('/', createSupplier);
router.patch('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

module.exports = router;