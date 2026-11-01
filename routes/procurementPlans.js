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
  getPlanIntegrationInsights,
} = require('../controllers/procurement/plansController');

const capability = require('../middleware/planningPermission');
router.use(authenticateUser);
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });

router.post('/', capability('manage'), upload.single('plan'), uploadPlan);
router.get('/', capability(), getPlans);
router.get('/request/:id', capability(), getPlanForRequest);
router.post('/:id/items', capability('manage'), createPlanItems);
router.get('/:id/items/variance', capability(), getPlanItemVariance);
router.get('/:id/integration-insights', capability(), getPlanIntegrationInsights);
router.get('/:id/items', capability(), getPlanItems);
router.post('/:id/items/:itemId/requests', capability('manage'), linkPlanItemRequests);
router.post('/:id/items/:itemId/consumptions', capability('manage'), linkPlanItemConsumptions);
router.get('/:id/download', capability(), downloadPlan);
router.get('/:id', capability(), getPlanById);

module.exports = router;