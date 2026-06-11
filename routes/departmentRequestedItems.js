const express = require('express');
const {
  getDepartmentRequestedItems,
  getSummary,
  createFollowUpMessagePreview,
  createFollowUpNote,
} = require('../controllers/departmentRequestedItemsController');

const router = express.Router();

router.get('/', getDepartmentRequestedItems);
router.get('/summary', getSummary);
router.post('/follow-up-message-preview', createFollowUpMessagePreview);
router.post('/follow-up-note', createFollowUpNote);

module.exports = router;