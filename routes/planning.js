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

const capability = require('../middleware/planningPermission');
router.use(authenticateUser);
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });

router.post('/forecast', capability(), getDemandForecast);
router.post('/safety-stock', capability(), calculateSafetyStock);
router.post('/mrp', capability(), runMrp);
router.get('/defaults', capability(), getPlanningDefaults);
router.post('/defaults', capability('manage'), savePlanningDefaults);
router.post('/replenishment/policies', capability('replenish'), saveReplenishmentPolicy);
router.post('/replenishment/run', capability('replenish'), runReplenishmentPlanner);

module.exports = router;