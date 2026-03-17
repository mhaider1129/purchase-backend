const express = require('express');
const router = express.Router();
const {
  getRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  simulateRouteChanges,
} = require('../controllers/approvalRoutesController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.use(authenticateUser);

router.get('/', getRoutes);
router.post('/', createRoute);
router.post('/simulate', simulateRouteChanges);
router.put('/:id', updateRoute);
router.delete('/:id', deleteRoute);

module.exports = router;