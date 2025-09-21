// middleware/errorHandler.js

const fs = require('fs'); // Optional for future file logging
const path = require('path');

// 🔥 Global Error Handling Middleware
const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // 🧠 Extract status and message
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // 🛠 PostgreSQL-specific error codes
  switch (err.code) {
    case '23505': // Unique violation
      return res.status(409).json({
        success: false,
        message: 'Conflict: Duplicate entry',
      });

    case '22P02': // Invalid input syntax (e.g., malformed UUID)
      return res.status(400).json({
        success: false,
        message: 'Invalid input syntax',
      });

    case '23503': // Foreign key violation
      return res.status(400).json({
        success: false,
        message: 'Invalid reference: Related record not found',
      });

    case '23514': // Check constraint violation
      return res.status(400).json({
        success: false,
        message: 'Check constraint failed',
      });

    // Add more database-specific errors if needed
  }

  // 📄 Log errors (console or file)
  if (!isProduction) {
    console.error('❌ Error Stack:', err.stack || err);
  } else {
    console.error('❌ Error:', message);
    // Optional: log to file instead of console
    /*
    const logPath = path.resolve(__dirname, '../logs/error.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} - ${message}\n`);
    */
  }

  // 🧾 Standardized error response
  res.status(statusCode).json({
    success: false,
    message,
    ...(isProduction ? {} : { code: err.code, stack: err.stack }),
  });
};

module.exports = errorHandler;
