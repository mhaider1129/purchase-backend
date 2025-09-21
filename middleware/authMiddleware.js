// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// 🔧 Reusable error generator
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// 🔐 JWT Authentication Middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(createHttpError(401, 'Unauthorized: Missing or malformed token'));
    }

    const token = authHeader.split(' ')[1];

    // ✅ Verify JWT Token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error('❌ JWT verification failed:', err.message);
      return next(createHttpError(401, 'Unauthorized: Invalid or expired token'));
    }

    // 🔎 Fetch user from DB
    const userRes = await pool.query(
      `SELECT id, name, role, department_id, is_active, can_request_medication
         FROM users WHERE id = $1`,
      [decoded.user_id]
    );

    if (userRes.rowCount === 0) {
      return next(createHttpError(401, 'Unauthorized: User not found'));
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return next(createHttpError(401, 'Unauthorized: User is deactivated'));
    }

    // ✅ Attach user context to request
    req.user = {
      id: user.id,
      name: user.name,
      role: user.role,
      department_id: user.department_id,
      can_request_medication: user.can_request_medication,
    };

    next();
  } catch (err) {
    console.error('❌ Unexpected error in authenticateUser middleware:', err);
    next(createHttpError(500, 'Authentication middleware failed'));
  }
};

module.exports = { authenticateUser };
