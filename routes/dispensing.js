const express = require('express');
const {
  importMonthlyDispensing,
  getMonthlyDispensing,
  getMonthlyAnalytics,
} = require('../controllers/dispensingController');

const router = express.Router();

router.post('/monthly/import', importMonthlyDispensing);
router.get('/monthly', getMonthlyDispensing);
router.get('/monthly/analytics', getMonthlyAnalytics);

module.exports = router;