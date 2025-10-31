// middleware/upload.js
const multer = require('multer');
const path = require('path');

// ✅ Allowed extensions
const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

// 🧠 Storage configuration (in-memory so we can forward to Supabase or other remote storage)
const storage = multer.memoryStorage();

// 🛡️ File filter (extension check)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    error.message = `❌ Unsupported file type: ${ext}. Allowed: ${allowedExtensions.join(', ')}`;
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