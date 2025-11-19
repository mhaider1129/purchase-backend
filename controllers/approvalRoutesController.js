const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const DEFAULT_MIN_AMOUNT = 0;
const DEFAULT_MAX_AMOUNT = 999999999;

const normalizeRoutePayload = (payload = {}) => {
  const sanitizeString = (value, field) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      throw createHttpError(400, `${field} is required`);
    }
    return trimmed;
  };

  const parsePositiveInteger = (value, field) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw createHttpError(400, `${field} must be a positive whole number`);
    }
    return parsed;
  };

  const parseAmount = (value, fallback, field) => {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw createHttpError(400, `${field} must be a non-negative number`);
    }
    return Math.trunc(parsed);
  };

  const requestType = sanitizeString(payload.request_type, 'Request type');
  const departmentType = sanitizeString(
    payload.department_type,
    'Department type',
  ).toLowerCase();
  const role = sanitizeString(payload.role, 'Role');
  const approvalLevel = parsePositiveInteger(
    payload.approval_level,
    'Approval level',
  );
  const minAmount = parseAmount(
    payload.min_amount,
    DEFAULT_MIN_AMOUNT,
    'Minimum amount',
  );
  const maxAmount = parseAmount(
    payload.max_amount,
    DEFAULT_MAX_AMOUNT,
    'Maximum amount',
  );

  if (minAmount > maxAmount) {
    throw createHttpError(
      400,
      'Minimum amount cannot be greater than the maximum amount',
    );
  }

  return {
    request_type: requestType,
    department_type: departmentType,
    approval_level: approvalLevel,
    role,
    min_amount: minAmount,
    max_amount: maxAmount,
  };
};

const getRoutes = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, request_type, department_type, approval_level, role, min_amount, max_amount
       FROM approval_routes
       ORDER BY request_type, department_type, approval_level`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch approval routes:', err);
    next(createHttpError(500, 'Failed to fetch approval routes'));
  }
};

const createRoute = async (req, res, next) => {
  if (!req.user.hasPermission('permissions.manage')) {
    return next(createHttpError(403, 'You do not have permission to modify routes'));
  }

  let normalizedPayload;
  try {
    normalizedPayload = normalizeRoutePayload(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO approval_routes (request_type, department_type, approval_level, role, min_amount, max_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        normalizedPayload.request_type,
        normalizedPayload.department_type,
        normalizedPayload.approval_level,
        normalizedPayload.role,
        normalizedPayload.min_amount,
        normalizedPayload.max_amount,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create approval route:', err);
    next(createHttpError(500, 'Failed to create approval route'));
  }
};

const updateRoute = async (req, res, next) => {
  if (!req.user.hasPermission('permissions.manage')) {
    return next(createHttpError(403, 'You do not have permission to modify routes'));
  }
  const { id } = req.params;
  let normalizedPayload;

  try {
    normalizedPayload = normalizeRoutePayload(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE approval_routes
       SET request_type = $1,
           department_type = $2,
           approval_level = $3,
           role = $4,
           min_amount = $5,
           max_amount = $6
       WHERE id = $7
       RETURNING *`,
      [
        normalizedPayload.request_type,
        normalizedPayload.department_type,
        normalizedPayload.approval_level,
        normalizedPayload.role,
        normalizedPayload.min_amount,
        normalizedPayload.max_amount,
        id,
      ]
    );

    if (rows.length === 0) return next(createHttpError(404, 'Route not found'));
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update approval route:', err);
    next(createHttpError(500, 'Failed to update approval route'));
  }
};

const deleteRoute = async (req, res, next) => {
  if (!req.user.hasPermission('permissions.manage')) {
    return next(createHttpError(403, 'You do not have permission to modify routes'));
  }
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM approval_routes WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return next(createHttpError(404, 'Route not found'));
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete approval route:', err);
    next(createHttpError(500, 'Failed to delete approval route'));
  }
};

module.exports = { getRoutes, createRoute, updateRoute, deleteRoute };