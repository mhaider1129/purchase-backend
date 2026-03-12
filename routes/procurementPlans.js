const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  uploadPlan,
  getPlans,
  getPlanById,
  getPlanForRequest,
  downloadPlan,
  createPlanItems,
  getPlanItems,
  linkPlanItemRequests,
  linkPlanItemConsumptions,
  getPlanItemVariance,
} = require('../controllers/procurement/plansController');

router.use(authenticateUser);

router.post('/', upload.single('plan'), uploadPlan);
router.get('/', getPlans);
router.get('/request/:id', getPlanForRequest);
router.post('/:id/items', createPlanItems);
router.get('/:id/items/variance', getPlanItemVariance);
router.get('/:id/items', getPlanItems);
router.post('/:id/items/:itemId/requests', linkPlanItemRequests);
router.post('/:id/items/:itemId/consumptions', linkPlanItemConsumptions);
router.get('/:id/download', downloadPlan);
router.get('/:id', getPlanById);

module.exports = router;