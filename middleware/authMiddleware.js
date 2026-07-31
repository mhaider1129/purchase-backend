const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {
  getPermissionsForUserId,
  buildPermissionSet,
  userHasPermission,
} = require('../utils/permissionService');

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function isDatabaseConnectivityError(error) {
  const codes = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT']);
  return Boolean(error && (codes.has(error.code) || /(getaddrinfo|ECONNREFUSED|ECONNRESET|timeout)/i.test(error.message || '')));
}

function jwtVerificationOptions(environment = process.env) {
  const algorithm = environment.JWT_ALGORITHM || 'HS256';
  const supportedAlgorithms = new Set(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);
  if (!supportedAlgorithms.has(algorithm)) {
    throw createHttpError(503, 'Authorization service is unavailable', 'AUTH_CONFIGURATION_ERROR');
  }
  const options = { algorithms: [algorithm] };
  if (environment.JWT_ISSUER) options.issuer = environment.JWT_ISSUER;
  if (environment.JWT_AUDIENCE) options.audience = environment.JWT_AUDIENCE;
  return options;
}

function parseBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

async function attachUserFromToken(token, dependencies = {}) {
  const verify = dependencies.verify || jwt.verify;
  const database = dependencies.pool || pool;
  const permissionLookup = dependencies.getPermissionsForUserId || getPermissionsForUserId;
  let decoded;
  try {
    decoded = verify(token, process.env.JWT_SECRET, jwtVerificationOptions());
  } catch (error) {
    if (error?.code === 'AUTH_CONFIGURATION_ERROR') throw error;
    throw createHttpError(401, 'Unauthorized: Invalid or expired token', 'INVALID_TOKEN');
  }

  if (!Number.isInteger(decoded?.user_id) || decoded.user_id <= 0) {
    throw createHttpError(401, 'Unauthorized: Token has no valid user identity', 'INVALID_TOKEN_SUBJECT');
  }

  const userResult = await database.query(
    `SELECT u.id, u.name, u.role, u.department_id, u.section_id, u.institute_id, u.warehouse_id,
            u.is_active, u.can_request_medication,
            COALESCE(assigned_sections.section_ids, '[]'::json) AS assigned_section_ids
       FROM users u
       LEFT JOIN LATERAL (
         SELECT json_agg(usa.section_id ORDER BY usa.section_id) AS section_ids
           FROM user_section_assignments usa WHERE usa.user_id = u.id
       ) assigned_sections ON TRUE
      WHERE u.id = $1`,
    [decoded.user_id]
  );
  if (userResult.rowCount === 0) throw createHttpError(401, 'Unauthorized: User not found', 'USER_NOT_FOUND');
  const user = userResult.rows[0];
  if (!user.is_active) throw createHttpError(401, 'Unauthorized: User is deactivated', 'USER_INACTIVE');

  let authorization;
  try {
    authorization = await permissionLookup(user.id);
    if (!authorization || !Array.isArray(authorization.permissions) ||
        (authorization.dataScopes != null && (typeof authorization.dataScopes !== 'object' || Array.isArray(authorization.dataScopes)))) {
      throw new TypeError('Malformed authorization data');
    }
  } catch (error) {
    const authError = createHttpError(503, 'Authorization service is unavailable', 'AUTHORIZATION_SERVICE_UNAVAILABLE');
    authError.cause = error;
    throw authError;
  }

  const context = {
    id: user.id, user_id: decoded.user_id, name: user.name, role: user.role,
    department_id: user.department_id, section_id: user.section_id,
    assigned_section_ids: user.assigned_section_ids || [], institute_id: user.institute_id,
    warehouse_id: user.warehouse_id, can_request_medication: user.can_request_medication,
    permissions: authorization.permissions, data_scopes: authorization.dataScopes || {},
  };
  context.permissionSet = buildPermissionSet(context.permissions);
  context.hasPermission = code => userHasPermission(context, code);
  context.hasAnyPermission = codes => Array.isArray(codes) && codes.some(code => userHasPermission(context, code));
  context.requirePermission = code => {
    if (!userHasPermission(context, code)) throw createHttpError(403, 'You do not have permission to perform this action');
  };
  return context;
}

function handleAuthenticationError(error, next) {
  if (isDatabaseConnectivityError(error)) return next(createHttpError(503, 'Service Unavailable: Unable to connect to the database'));
  if (error?.statusCode) return next(error);
  return next(createHttpError(500, 'Authentication middleware failed'));
}

async function authenticateUser(req, _res, next) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) return next(createHttpError(401, 'Unauthorized: Missing or malformed token'));
  try { req.user = await attachUserFromToken(token); return next(); }
  catch (error) { return handleAuthenticationError(error, next); }
}

async function authenticateUserOptional(req, _res, next) {
  const header = req.headers.authorization;
  if (!header) return next();
  const token = parseBearerToken(header);
  if (!token) return next(createHttpError(401, 'Unauthorized: Missing or malformed token'));
  try { req.user = await attachUserFromToken(token); return next(); }
  catch (error) { return handleAuthenticationError(error, next); }
}

module.exports = {
  authenticateUser, authenticateUserOptional, attachUserFromToken, parseBearerToken,
  jwtVerificationOptions, isDatabaseConnectivityError,
};