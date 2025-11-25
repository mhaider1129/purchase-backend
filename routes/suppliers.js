const express = require('express');
const { listSuppliers, createSupplier } = require('../controllers/suppliersController');

const router = express.Router();

router.get('/', listSuppliers);
router.post('/', createSupplier);

module.exports = router;