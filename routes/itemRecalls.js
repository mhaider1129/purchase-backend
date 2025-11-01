const express = require('express');
const router = express.Router();

const {
  createDepartmentRecallRequest,
  createWarehouseRecallRequest,
  escalateRecallToProcurement,
} = require('../controllers/itemRecallsController');

// Department users submit recall requests to the warehouse
router.post('/department', createDepartmentRecallRequest);

// Warehouse users can initiate recalls to procurement directly
router.post('/warehouse', createWarehouseRecallRequest);

// Warehouse users can escalate an existing department recall to procurement
router.post('/:id/escalate', escalateRecallToProcurement);

module.exports = router;