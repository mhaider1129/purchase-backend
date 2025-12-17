const express = require('express');
const { listRisks, createRisk, updateRisk } = require('../controllers/riskManagementController');

const router = express.Router();

router.get('/', listRisks);
router.post('/', createRisk);
router.patch('/:id', updateRisk);

module.exports = router;