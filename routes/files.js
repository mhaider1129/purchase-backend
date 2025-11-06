const express = require('express');
const router = express.Router();
const { getFileById, deleteFile } = require('../controllers/filesController');
const { authenticateUser } = require('../middleware/authMiddleware');

router.get('/:fileId', getFileById);
router.delete('/:id', authenticateUser, deleteFile);

module.exports = router;
