const express = require('express');
const {
  listRfxEvents,
  createRfxEvent,
  submitRfxResponse,
  listRfxResponses,
  updateRfxStatus,
  analyzeQuotations,
} = require('../controllers/rfxPortalController');

const router = express.Router();

router.get('/', listRfxEvents);
router.post('/', createRfxEvent);
router.patch('/:id/status', updateRfxStatus);
router.get('/:id/responses', listRfxResponses);
router.post('/:id/responses', submitRfxResponse);
router.post('/:id/analyze', analyzeQuotations);

module.exports = router;