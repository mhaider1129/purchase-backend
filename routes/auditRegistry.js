const express = require('express');
const {
  createAuditEntry,
  getMyAuditRequests,
  updateAuditEntry,
} = require('../controllers/auditRegistryController');

const router = express.Router();

router.get('/my-requests', getMyAuditRequests);
router.post('/entries', createAuditEntry);
router.post('/requests/:requestId/entries', createAuditEntry);
router.patch('/entries/:entryId', updateAuditEntry);

module.exports = router;