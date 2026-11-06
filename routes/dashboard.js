const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getDepartmentMonthlySpending,
  getDepartmentMonthlyRequestCosts,
  getLifecycleAnalytics,
  getWorkloadAnalysis,
} = require('../controllers/dashboardController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/summary', authenticateUser, getDashboardSummary);
router.get('/department-spending', authenticateUser, getDepartmentMonthlySpending);
router.get('/department-request-costs', authenticateUser, getDepartmentMonthlyRequestCosts);
router.get('/lifecycle', authenticateUser, getLifecycleAnalytics);
router.get('/workload', authenticateUser, getWorkloadAnalysis);


const reporting=require('../services/procurementReportingService');
router.get('/completion',authenticateUser,async(req,res,next)=>{
  try{const data=await reporting.list(req.user,req.query);res.json(data);}catch(e){next(e);}
});
router.get('/completion-summary',authenticateUser,async(req,res,next)=>{
  try{res.json(await reporting.summary(req.user,req.query));}catch(e){next(e);}
});

module.exports = router;