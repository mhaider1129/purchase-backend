//controllers/filesController.js
const fs = require('fs/promises');
const path = require('path');
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const deleteFile = async (req, res, next) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (rows.length === 0) {
      return next(createHttpError(404, 'File not found in database'));
    }

    const file = rows[0];

    // ✅ Authorization Check
// req.user is populated by authMiddleware with an `id` property
    // rather than `user_id`, so use `id` for comparison
    if (req.user.role !== 'Admin' && req.user.id !== file.uploader_id) {      return next(createHttpError(403, 'You are not authorized to delete this file'));
    }

    const filePath = path.resolve(__dirname, '..', 'uploads', file.filename);

    try {
      await fs.unlink(filePath);
      console.log(`🗑️ Deleted file from disk: ${filePath}`);
    } catch (fsErr) {
      console.warn(`⚠️ File missing on disk: ${filePath}. Skipping disk deletion.`);
    }

    await pool.query(`DELETE FROM files WHERE id = $1`, [id]);
    console.log(`✅ Deleted file record from DB: ${file.filename}`);

    res.status(200).json({
      message: '✅ File deleted successfully',
      deleted_file: {
        id: file.id,
        filename: file.filename,
        originalname: file.originalname
      }
    });

  } catch (err) {
    console.error('❌ File deletion error:', err);
    next(createHttpError(500, 'Failed to delete file'));
  }
};

module.exports = { deleteFile };
