const express = require('express');
const { listPolicies, updatePolicy } = require('../controllers/capabilityPoliciesController');

const router = express.Router();
router.get('/', listPolicies);
router.put('/', updatePolicy);

module.exports = router;