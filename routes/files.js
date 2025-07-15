//routes/files.js
const express = require('express');
const router = express.Router();
const { deleteFile } = require('../controllers/filesController');
const { authenticateUser } = require('../middleware/authMiddleware');

/**
 * @route   DELETE /api/files/:id
 * @desc    Delete a file by ID (removes DB record and physical file from /uploads)
 * @access  Private (Authenticated users only)
 * @returns { message, deleted_file } on success
 */
router.delete('/:id', authenticateUser, deleteFile);

module.exports = router;