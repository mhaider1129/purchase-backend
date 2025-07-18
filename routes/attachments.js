// routes/attachments.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const upload = require('../middleware/upload');
const { authenticateUser } = require('../middleware/authMiddleware');
const sanitize = require('sanitize-filename');

// 🔧 Local error helper
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// 📥 Upload a file to a specific item

// 📥 Upload a file to a request
router.post('/:requestId', authenticateUser, upload.single('file'), async (req, res, next) => {
  const { requestId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    const saved = await pool.query(
      `INSERT INTO attachments (request_id, item_id, file_name, file_path, uploaded_by)
       VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
      [requestId, file.originalname, file.path, req.user.id]
    );

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    next(createHttpError(500, 'Failed to upload attachment'));
  }
});

// 📄 Fetch all attachments for a request
router.get('/:requestId', authenticateUser, async (req, res, next) => {
  const { requestId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, file_name, file_path, uploaded_by, uploaded_at
       FROM attachments
       WHERE request_id = $1`,
      [requestId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
});

// 📥 Upload a file to a specific item
router.post('/item/:itemId', authenticateUser, upload.single('file'), async (req, res, next) => {
  const { itemId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    const saved = await pool.query(
      `INSERT INTO attachments (request_id, item_id, file_name, file_path, uploaded_by)
       VALUES (NULL, $1, $2, $3, $4) RETURNING id`,
      [itemId, file.originalname, file.path, req.user.id]
    );

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    next(createHttpError(500, 'Failed to upload attachment'));
  }
});

// 📄 Fetch attachments for a specific item
router.get('/item/:itemId', authenticateUser, async (req, res, next) => {
  const { itemId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, file_name, file_path, uploaded_by, uploaded_at
       FROM attachments
       WHERE item_id = $1`,
      [itemId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
});

// 📤 Download a file (authentication required)
router.get('/download/:filename', authenticateUser, (req, res, next) => {
  const sanitizedFilename = sanitize(req.params.filename);
  const filePath = path.join(__dirname, '..', 'uploads', sanitizedFilename);

  fs.access(filePath, fs.constants.F_OK, err => {
    if (err) {
      console.warn('🟥 File not found:', filePath);
      return next(createHttpError(404, 'File not found'));
    }

    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.download(filePath);
  });
});

// 🗑️ Delete a file (only by uploader or admin)
router.delete('/:id', authenticateUser, async (req, res, next) => {
  const { id } = req.params;
  const { id: userId, role: userRole } = req.user;

  try {
    const result = await pool.query(`SELECT * FROM attachments WHERE id = $1`, [id]);
    if (result.rowCount === 0)
      return next(createHttpError(404, 'File not found'));

    const file = result.rows[0];

    if (file.uploaded_by !== userId && userRole !== 'admin') {
      return next(createHttpError(403, 'Not authorized to delete this file'));
    }

    await pool.query(`DELETE FROM attachments WHERE id = $1`, [id]);

    const filePath = path.resolve(__dirname, '..', file.file_path);
    fs.unlink(filePath, err => {
      if (err && err.code !== 'ENOENT') {
        console.warn('🟡 Could not delete file from disk:', err.message);
      }
    });

    res.json({ message: '🗑️ File deleted successfully' });
  } catch (err) {
    console.error('❌ File deletion error:', err.message);
    next(createHttpError(500, 'Failed to delete file'));
  }
});

module.exports = router;
