// middleware/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sanitize = require('sanitize-filename');

// ✅ Allowed extensions
const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

// ✅ Upload directory
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 🧠 Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const uniqueId = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = sanitize(
      path.basename(file.originalname.trim(), ext).replace(/\s+/g, '_').toLowerCase()
    );
    cb(null, `${timestamp}-${uniqueId}-${baseName}${ext}`);
  }
});

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
    fileSize: 20 * 1024 * 1024 // 5MB
  }
});

module.exports = upload;
