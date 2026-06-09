// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {
  getPermissionsForUserId,
  buildPermissionSet,
  userHasPermission,
  getDefaultPermissionsForRole,
} = require('../utils/permissionService');
const ensureWarehouseAssignments = require('../utils/ensureWarehouseAssignments');

// 🔧 Reusable error generator
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isDatabaseConnectivityError(err) {
  if (!err) return false;

  const connectionErrorCodes = new Set([
    'ENOTFOUND',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ETIMEDOUT',
  ]);

  if (err.code && connectionErrorCodes.has(err.code)) {
    return true;
  }

  const message = typeof err.message === 'string' ? err.message : '';
  return /(getaddrinfo|connect\s+ECONNREFUSED|ECONNRESET|timeout)/i.test(message);
}

function isPermissionLookupError(err) {
  if (!err) return false;

  if (isDatabaseConnectivityError(err)) {
    return false;
  }

  const permissionErrorCodes = new Set([
    '42P01', // undefined_table
    '42703', // undefined_column
    '42883', // undefined_function/operator
    '42501', // insufficient_privilege
  ]);

  if (err.code && permissionErrorCodes.has(err.code)) {
    return true;
  }

  const message = typeof err.message === 'string' ? err.message : '';
  return /(permission|user_permissions|data_scopes|role_permissions|relation .* does not exist|column .* does not exist)/i.test(message);
}

// 🔐 JWT Authentication Middleware
const attachUserFromToken = async (token) => {
  // ✅ Verify JWT Token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error('❌ JWT verification failed:', err.message);
    throw createHttpError(401, 'Unauthorized: Invalid or expired token');
  }

  // Ensure required warehouse-related columns exist before querying
  await ensureWarehouseAssignments();

  // 🔎 Fetch user from DB
  const userRes = await pool.query(
    `SELECT id, name, role, department_id, institute_id, warehouse_id, is_active, can_request_medication
         FROM users WHERE id = $1`,
    [decoded.user_id]
  );

  if (userRes.rowCount === 0) {
    throw createHttpError(401, 'Unauthorized: User not found');
  }

  const user = userRes.rows[0];

  if (!user.is_active) {
    throw createHttpError(401, 'Unauthorized: User is deactivated');
  }

  let permissions = [];
  let dataScopes = {};
  try {
    ({ permissions = [], dataScopes = {} } = await getPermissionsForUserId(user.id));
  } catch (err) {
    if (!isPermissionLookupError(err)) {
      throw err;
    }

    permissions = getDefaultPermissionsForRole(user.role);
    dataScopes = {};
    console.warn(
      `⚠️ Falling back to default role permissions for user ${user.id} because permission lookup failed: ${err.message}`
    );
  }

  const userContext = {
    id: user.id,
    user_id: decoded.user_id,
    name: user.name,
    role: user.role,
    department_id: user.department_id,
    institute_id: user.institute_id,
    warehouse_id: user.warehouse_id,
    can_request_medication: user.can_request_medication,
    permissions,
    data_scopes: dataScopes,
  };

  userContext.permissionSet = buildPermissionSet(permissions);
  userContext.hasPermission = permissionCode => userHasPermission(userContext, permissionCode);
  userContext.hasAnyPermission = codes =>
    Array.isArray(codes) && codes.some(code => userHasPermission(userContext, code));
  userContext.requirePermission = (code) => {
    if (!userHasPermission(userContext, code)) {
      throw createHttpError(403, 'You do not have permission to perform this action');
    }
  };

  return userContext;
};

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(createHttpError(401, 'Unauthorized: Missing or malformed token'));
    }

    const token = authHeader.split(' ')[1];
    req.user = await attachUserFromToken(token);

    next();
  } catch (err) {
    console.error('❌ Unexpected error in authenticateUser middleware:', err);

    if (isDatabaseConnectivityError(err)) {
      return next(createHttpError(503, 'Service Unavailable: Unable to connect to the database'));
    }

    if (err?.statusCode) {
      return next(err);
    }

    next(createHttpError(500, 'Authentication middleware failed'));
  }
};

const authenticateUserOptional = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    req.user = await attachUserFromToken(token);

    next();
  } catch (err) {
    if (isDatabaseConnectivityError(err)) {
      return next(createHttpError(503, 'Service Unavailable: Unable to connect to the database'));
    }

    if (err?.statusCode) {
      return next(err);
    }

    next(createHttpError(500, 'Authentication middleware failed'));
  }
};

module.exports = { authenticateUser, authenticateUserOptional };