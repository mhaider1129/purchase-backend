const express = require('express');
const {
  createContractEvaluation,
  getContractEvaluations,
  updateContractEvaluation,
  getMyEvaluations,
  getEvaluationCriteria,
} = require('../controllers/contractEvaluationsController');

const router = express.Router();

router.get('/criteria', getEvaluationCriteria);
router.get('/my-evaluations', getMyEvaluations);
router.get('/', getContractEvaluations);
router.post('/', createContractEvaluation);
router.patch('/:id', updateContractEvaluation);

module.exports = router;