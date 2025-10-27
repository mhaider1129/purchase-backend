const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  createCustodyRecord,
  getPendingCustodyApprovals,
  actOnCustodyRecord,
  searchCustodyRecipients,
} = require('../controllers/custodyController');

router.use(authenticateUser);

router.get('/recipients/search', searchCustodyRecipients);
router.get('/pending', getPendingCustodyApprovals);
router.post('/', createCustodyRecord);
router.patch('/:id/decision', actOnCustodyRecord);

module.exports = router;