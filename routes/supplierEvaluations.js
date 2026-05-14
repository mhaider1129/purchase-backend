const express = require('express');

const {
  listSupplierEvaluations,
  getSupplierEvaluationBenchmarks,
  getSupplierEvaluationById,
  getSupplierEvaluationDashboard,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  deleteSupplierEvaluation,
  listSupplierEvaluationCriteria,
  createSupplierEvaluationCriteria,
  updateSupplierEvaluationCriteria,
  deleteSupplierEvaluationCriteria,
} = require('../controllers/supplierEvaluationsController');

const router = express.Router();

router.get('/', listSupplierEvaluations);
router.get('/benchmarks', getSupplierEvaluationBenchmarks);
router.get('/dashboard', getSupplierEvaluationDashboard);

router.get('/criteria', listSupplierEvaluationCriteria);
router.post('/criteria', createSupplierEvaluationCriteria);
router.put('/criteria/:id', updateSupplierEvaluationCriteria);
router.delete('/criteria/:id', deleteSupplierEvaluationCriteria);
router.get('/:id', getSupplierEvaluationById);
router.post('/', createSupplierEvaluation);
router.put('/:id', updateSupplierEvaluation);
router.delete('/:id', deleteSupplierEvaluation);

module.exports = router;