const express = require('express');
const {
  listAutoAssignmentRules,
  upsertAutoAssignmentRule,
  updateAutoAssignmentRule,
  deleteAutoAssignmentRule,
} = require('../controllers/requestAutoAssignmentRulesController');

const router = express.Router();

router.get('/', listAutoAssignmentRules);
router.post('/', upsertAutoAssignmentRule);
router.put('/:id', updateAutoAssignmentRule);
router.delete('/:id', deleteAutoAssignmentRule);

module.exports = router;