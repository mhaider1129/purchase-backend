// middleware/errorHandler.js

const { log } = require('../utils/observability');

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

  const payload = {
    requestId: req?.requestId,
    statusCode,
    errorCode: err.code,
    path: req?.originalUrl,
    method: req?.method,
  };

  if (!isProduction) {
    log('error', 'request_failed', {
      ...payload,
      message,
      stack: err.stack,
    });
  } else {
    log('error', 'request_failed', {
      ...payload,
      message,
    });
  }

  // 🧾 Standardized error response
  res.status(statusCode).json({
    success: false,
    message,
    requestId: req?.requestId,
    ...(isProduction ? {} : { code: err.code, stack: err.stack }),
  });
};

module.exports = errorHandler;