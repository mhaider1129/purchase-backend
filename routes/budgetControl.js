const express = require('express');
const { listDepartmentBudgets, upsertDepartmentBudget } = require('../controllers/budgetControlController');

const router = express.Router();

router.get('/', listDepartmentBudgets);
router.post('/', upsertDepartmentBudget);

module.exports = router;