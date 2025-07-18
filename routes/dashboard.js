const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getDepartmentMonthlySpending,
} = require('../controllers/dashboardController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/summary', authenticateUser, getDashboardSummary);
router.get('/department-spending', authenticateUser, getDepartmentMonthlySpending);

module.exports = router;