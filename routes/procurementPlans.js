const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  uploadPlan,
  getPlans,
  getPlanById,
  getPlanForRequest,
} = require('../controllers/procurement/plansController');

router.use(authenticateUser);

router.post('/', upload.single('plan'), uploadPlan);
router.get('/', getPlans);
router.get('/request/:id', getPlanForRequest);
router.get('/:id', getPlanById);

module.exports = router;