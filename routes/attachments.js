// routes/attachments.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream');
const { URL } = require('url');
const pool = require('../config/db');
const upload = require('../middleware/upload');
const { authenticateUser } = require('../middleware/authMiddleware');
const {
  insertAttachment,
  attachmentsHasItemIdColumn,
} = require('../utils/attachmentSchema');
const {
  UPLOADS_DIR,
  serializeAttachment,
  isStoredLocally,
} = require('../utils/attachmentPaths');
const { removeObject, isStorageConfigured, buildObjectDownloadRequest } = require('../utils/storage');
const { storeAttachmentFile } = require('../utils/attachmentStorage');
const sanitize = require('sanitize-filename');

// 🔧 Local error helper
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function uploadAttachmentToStorage({ file, requestId, itemId }) {
  return storeAttachmentFile({ file, requestId, itemId });
}

function respondStorageError(next, err) {
  console.error('❌ Upload error:', err.message);
  if (err.code === 'SUPABASE_NOT_CONFIGURED') {
    return next(
      createHttpError(
        500,
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      )
    );
  }

  return next(createHttpError(500, 'Failed to upload attachment'));
}

function streamRemoteAttachment({ objectKey, res, fallbackFilename, next }) {
  let requestConfig;

  try {
    requestConfig = buildObjectDownloadRequest(objectKey);
  } catch (err) {
    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }

    console.error('❌ Failed to prepare remote attachment request:', err.message);
    next(createHttpError(500, 'Failed to download attachment'));
    return;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(requestConfig.url);
  } catch (err) {
    console.error('❌ Invalid download URL for attachment:', err.message);
    next(createHttpError(500, 'Failed to download attachment'));
    return;
  }

  const client = parsedUrl.protocol === 'http:' ? http : https;

  const request = client.get(
    requestConfig.url,
    { headers: requestConfig.headers },
    storageRes => {
      const status = storageRes.statusCode || 0;

      if (status >= 400) {
        storageRes.resume();

      let error;
      if (status === 404) {
        error = createHttpError(404, 'Attachment not found');
      } else if (status === 401 || status === 403) {
        error = createHttpError(403, 'Attachment download is no longer authorized');
      } else {
        error = createHttpError(502, 'Failed to download attachment from remote storage');
      }

      console.error(
        `❌ Remote storage returned ${status} when downloading attachment: ${parsedUrl.pathname}`
      );
      next(error);
      return;
    }

    const contentType = storageRes.headers['content-type'] || 'application/octet-stream';
    const contentLength = storageRes.headers['content-length'];
    const disposition = storageRes.headers['content-disposition'];

    res.setHeader('Content-Type', contentType);

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    } else if (fallbackFilename) {
      const sanitized = sanitize(fallbackFilename) || 'attachment';
      res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
    }

    pipeline(storageRes, res, err => {
      if (!err) {
        return;
      }

      console.error('❌ Failed to stream attachment from remote storage:', err.message);

      if (res.headersSent) {
        res.destroy(err);
      } else {
        next(createHttpError(500, 'Failed to download attachment'));
      }
    });
    }
  );

  request.on('error', err => {
    console.error('❌ Error requesting remote attachment:', err.message);
    next(createHttpError(502, 'Failed to download attachment from remote storage'));
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      request.destroy();
    }
  });
}

// 📥 Upload a file to a specific item
router.post('/item/:itemId', authenticateUser, upload.single('file'), async (req, res, next) => {
  const { itemId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    const supportsItemAttachments = await attachmentsHasItemIdColumn(pool);
    if (!supportsItemAttachments) {
      return next(
        createHttpError(
          400,
          'Item-level attachments are not supported by the current database schema'
        )
      );
    }

    const { objectKey } = await uploadAttachmentToStorage({
      file,
      requestId: null,
      itemId,
    });

    const saved = await insertAttachment(pool, {
      requestId: null,
      itemId,
      fileName: file.originalname,
      filePath: objectKey,
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    respondStorageError(next, err);
  }
});

// 📄 Fetch attachments for a specific item
router.get('/item/:itemId', authenticateUser, async (req, res, next) => {
  const { itemId } = req.params;

  try {
    const supportsItemAttachments = await attachmentsHasItemIdColumn(pool);
    if (!supportsItemAttachments) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT id, file_name, file_path, uploaded_by, uploaded_at
       FROM attachments
       WHERE item_id = $1`,
      [itemId]
    );

    res.json(result.rows.map(serializeAttachment));
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
});

// 📤 Download attachment by id (supports Supabase-backed files)
router.get('/:id/download', authenticateUser, async (req, res, next) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, file_name, file_path FROM attachments WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return next(createHttpError(404, 'Attachment not found'));
    }

    const attachment = result.rows[0];
    const storedPath = attachment.file_path || '';

    if (!storedPath || isStoredLocally(storedPath)) {
      const filename = storedPath
        ? path.basename(storedPath)
        : sanitize(attachment.file_name || 'attachment');
      return res.redirect(`/api/attachments/download/${encodeURIComponent(filename)}`);
    }

    if (!isStorageConfigured()) {
      console.warn(
        '⚠️ Supabase storage is not configured; unable to prepare a download URL for remote attachments.'
      );
      return next(
        createHttpError(
          503,
          'Attachment storage is not configured. Please contact the system administrator.'
        )
      );
    }

    return streamRemoteAttachment({
      objectKey: storedPath,
      res,
      fallbackFilename: attachment.file_name || path.basename(storedPath) || 'attachment',
      next,
    });
  } catch (err) {
    console.error('❌ Failed to prepare attachment download:', err.message);

    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }

    next(createHttpError(500, 'Failed to download attachment'));
  }
});

// 📤 Download a file from local disk (legacy support)
router.get('/download/:filename', authenticateUser, (req, res, next) => {
  const sanitizedFilename = sanitize(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, sanitizedFilename);

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

// 📥 Upload a file to a request
router.post('/:requestId', authenticateUser, upload.single('file'), async (req, res, next) => {
  const { requestId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    const { objectKey } = await uploadAttachmentToStorage({
      file,
      requestId,
      itemId: null,
    });

    const saved = await insertAttachment(pool, {
      requestId,
      itemId: null,
      fileName: file.originalname,
      filePath: objectKey,
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    respondStorageError(next, err);
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

    res.json(result.rows.map(serializeAttachment));
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
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

    const storedPath = file.file_path || '';
    if (storedPath && isStoredLocally(storedPath)) {
      const filePath = path.resolve(__dirname, '..', storedPath);
      fs.unlink(filePath, err => {
        if (err && err.code !== 'ENOENT') {
          console.warn('🟡 Could not delete file from disk:', err.message);
        }
      });
    } else if (storedPath) {
      try {
        await removeObject(storedPath);
      } catch (storageErr) {
        console.warn('🟡 Failed to remove attachment from Supabase storage:', storageErr.message);
      }
    }

    res.json({ message: '🗑️ File deleted successfully' });
  } catch (err) {
    console.error('❌ File deletion error:', err.message);
    next(createHttpError(500, 'Failed to delete file'));
  }
});

module.exports = router;