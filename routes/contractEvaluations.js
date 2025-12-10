const express = require('express');
const {
  createContractEvaluation,
  getContractEvaluations,
  updateContractEvaluation,
  deleteContractEvaluation,
  getMyEvaluations,
  getEvaluationCriteria,
  getContractEvaluationById,
} = require('../controllers/contractEvaluationsController');

const router = express.Router();

router.get('/criteria', getEvaluationCriteria);
router.get('/my-evaluations', getMyEvaluations);
router.get('/', getContractEvaluations);
router.get('/:id', getContractEvaluationById);
router.post('/', createContractEvaluation);
router.patch('/:id', updateContractEvaluation);
router.delete('/:id', deleteContractEvaluation);

module.exports = router;