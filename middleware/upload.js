// middleware/upload.js
const multer = require('multer');
const path = require('path');

// ✅ Allowed extensions
const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.doc', '.docx', '.xlsx'];

const mimeToExtension = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
};

// 🧠 Storage configuration (in-memory so we can forward to Supabase or other remote storage)
const storage = multer.memoryStorage();

// 🛡️ File filter (extension check)
const fileFilter = (req, file, cb) => {
  const originalName = file.originalname || '';
  const extFromName = path.extname(originalName).toLowerCase();
  const ext = extFromName || mimeToExtension[(file.mimetype || '').toLowerCase()] || '';

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    error.message = `❌ Unsupported file type: ${ext || file.mimetype || 'unknown'}. Allowed: ${allowedExtensions.join(', ')}`;
    cb(error);
  }

  // ✅ Optional: check MIME type
  // const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
  // if (!allowedMimes.includes(file.mimetype)) {
  //   return cb(new Error('Invalid MIME type'));
  // }
};

// 🎯 Final multer config
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit
  }
});

module.exports = upload;