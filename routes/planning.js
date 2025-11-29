const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const { getDemandForecast, calculateSafetyStock, runMrp } = require('../controllers/demandPlanningController');

router.use(authenticateUser);

router.post('/forecast', getDemandForecast);
router.post('/safety-stock', calculateSafetyStock);
router.post('/mrp', runMrp);

module.exports = router;