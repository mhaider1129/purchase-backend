const router = require('express').Router();
const c = require('../controllers/rfidController');

// Service credentials apply only to ingestion endpoints. This router shares the
// /api/rfid prefix with the human-user routes, so a router-wide authentication
// middleware would reject those JWT requests before they reach their router.
router.post('/read-events', c.authenticateService, c.ingest);
router.post('/read-events/batch', c.authenticateService, c.ingest);

module.exports = router;