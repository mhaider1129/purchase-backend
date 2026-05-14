const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  getDemandForecast,
  calculateSafetyStock,
  runMrp,
  getPlanningDefaults,
  savePlanningDefaults,
  saveReplenishmentPolicy,
  runReplenishmentPlanner,
} = require('../controllers/demandPlanningController');

router.use(authenticateUser);

router.post('/forecast', getDemandForecast);
router.post('/safety-stock', calculateSafetyStock);
router.post('/mrp', runMrp);
router.get('/defaults', getPlanningDefaults);
router.post('/defaults', savePlanningDefaults);
router.post('/replenishment/policies', saveReplenishmentPolicy);
router.post('/replenishment/run', runReplenishmentPlanner);

module.exports = router;