const express = require('express');
const {
  listAutoAssignmentRules,
  upsertAutoAssignmentRule,
  updateAutoAssignmentRule,
  deleteAutoAssignmentRule,
} = require('../controllers/requestAutoAssignmentRulesController');

const router = express.Router();
router.use(require('../middleware/authMiddleware').authenticateUser);
router.use(require('../middleware/requirePermission')('requests.manage'));
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next();});

router.get('/', listAutoAssignmentRules);
router.post('/', upsertAutoAssignmentRule);
router.put('/:id', updateAutoAssignmentRule);
router.delete('/:id', deleteAutoAssignmentRule);

module.exports = router;