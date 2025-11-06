const pool = require('../config/db');
const { getSignedUrl, deleteS3File } = require('../utils/storage');

const getFileById = async (req, res, next) => {
  const { fileId } = req.params;

  try {
    const result = await pool.query('SELECT * FROM attachments WHERE id = $1', [fileId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = result.rows[0];
    const url = await getSignedUrl(file.s3_key);

    res.json({
      ...file,
      url,
    });
  } catch (err) {
    next(err);
  }
};

const deleteFile = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM attachments WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const file = result.rows[0];
    await deleteS3File(file.s3_key);
    await pool.query('DELETE FROM attachments WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'File deleted successfully',
      deleted_file: file,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getFileById,
  deleteFile,
};
