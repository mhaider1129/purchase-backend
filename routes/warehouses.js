const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
} = require('../controllers/warehousesController');

router.use(authenticateUser);

router.get('/', listWarehouses);
router.post('/', createWarehouse);
router.put('/:id', updateWarehouse);

module.exports = router;