const express = require('express');

const {
  listSupplierEvaluations,
  getSupplierEvaluationBenchmarks,
  getSupplierEvaluationById,
  getSupplierEvaluationDashboard,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  deleteSupplierEvaluation,
} = require('../controllers/supplierEvaluationsController');

const router = express.Router();

router.get('/', listSupplierEvaluations);
router.get('/benchmarks', getSupplierEvaluationBenchmarks);
router.get('/dashboard', getSupplierEvaluationDashboard);
router.get('/:id', getSupplierEvaluationById);
router.post('/', createSupplierEvaluation);
router.put('/:id', updateSupplierEvaluation);
router.delete('/:id', deleteSupplierEvaluation);

module.exports = router;