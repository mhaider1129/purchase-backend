const express = require('express');
const {
  createContractEvaluation,
  getContractEvaluations,
  updateContractEvaluation,
  getMyEvaluations,
} = require('../controllers/contractEvaluationsController');

const router = express.Router();

router.get('/my-evaluations', getMyEvaluations);
router.get('/', getContractEvaluations);
router.post('/', createContractEvaluation);
router.patch('/:id', updateContractEvaluation);

module.exports = router;