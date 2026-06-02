const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureRequestAutoAssignmentRulesTable = require('../utils/ensureRequestAutoAssignmentRulesTable');
const {
  AUTO_ASSIGNMENT_REQUEST_TYPES,
  normalizeRequestType,
  isSupportedAutoAssignmentType,
} = require('../services/requestAutoAssignmentService');

const canManageAutoAssignmentRules = user =>
  user?.hasAnyPermission?.(['requests.manage', 'permissions.manage', 'users.manage']) ||
  ['Admin', 'SCM'].includes(user?.role);

const parseOptionalId = value => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
};

const serializeRule = row => ({
  id: row.id,
  request_type: row.request_type,
  warehouse_id: row.warehouse_id,
  warehouse_name: row.warehouse_name,
  assignee_user_id: row.assignee_user_id,
  assignee_name: row.assignee_name,
  assignee_email: row.assignee_email,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const listAutoAssignmentRules = async (req, res, next) => {
  if (!canManageAutoAssignmentRules(req.user)) {
    return next(createHttpError(403, 'You do not have permission to manage auto-assignment rules'));
  }

  try {
    await ensureRequestAutoAssignmentRulesTable();
    const { rows } = await pool.query(
      `SELECT r.id,
              r.request_type,
              r.warehouse_id,
              w.name AS warehouse_name,
              r.assignee_user_id,
              u.name AS assignee_name,
              u.email AS assignee_email,
              r.is_active,
              r.created_at,
              r.updated_at
         FROM request_auto_assignment_rules r
         JOIN users u ON u.id = r.assignee_user_id
         LEFT JOIN warehouses w ON w.id = r.warehouse_id
        ORDER BY LOWER(r.request_type), w.name NULLS FIRST, u.name`,
    );

    return res.json({
      request_types: AUTO_ASSIGNMENT_REQUEST_TYPES,
      rules: rows.map(serializeRule),
    });
  } catch (err) {
    console.error('❌ Failed to list auto-assignment rules:', err);
    return next(createHttpError(500, 'Failed to load auto-assignment rules'));
  }
};

const validateRulePayload = async (client, body) => {
  const requestType = normalizeRequestType(body?.request_type);
  if (!requestType || !isSupportedAutoAssignmentType(requestType)) {
    throw createHttpError(400, 'Choose a supported request type for auto-assignment');
  }

  const warehouseId = parseOptionalId(body?.warehouse_id);
  if (Number.isNaN(warehouseId)) {
    throw createHttpError(400, 'warehouse_id must be a valid warehouse');
  }

  if (requestType.toLowerCase() === 'stock' && warehouseId === null) {
    throw createHttpError(400, 'Stock auto-assignment rules must select the submitted warehouse');
  }

  if (requestType.toLowerCase() !== 'stock' && warehouseId !== null) {
    throw createHttpError(400, 'Warehouse criteria is only available for Stock requests');
  }

  if (warehouseId !== null) {
    const warehouseCheck = await client.query('SELECT id FROM warehouses WHERE id = $1', [warehouseId]);
    if (warehouseCheck.rowCount === 0) {
      throw createHttpError(400, 'Selected warehouse does not exist');
    }
  }

  const assigneeId = Number(body?.assignee_user_id ?? body?.user_id);
  if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
    throw createHttpError(400, 'Choose a valid assignee');
  }

  const assigneeCheck = await client.query(
    `SELECT id
       FROM users
      WHERE id = $1
        AND is_active = TRUE
        AND role IN ('ProcurementSpecialist', 'SCM')`,
    [assigneeId],
  );
  if (assigneeCheck.rowCount === 0) {
    throw createHttpError(400, 'Assignee must be an active Procurement Specialist or SCM user');
  }

  const isActive = body?.is_active === undefined ? true : Boolean(body.is_active);
  return { requestType, warehouseId, assigneeId, isActive };
};

const upsertAutoAssignmentRule = async (req, res, next) => {
  if (!canManageAutoAssignmentRules(req.user)) {
    return next(createHttpError(403, 'You do not have permission to manage auto-assignment rules'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestAutoAssignmentRulesTable(client);
    const { requestType, warehouseId, assigneeId, isActive } = await validateRulePayload(client, req.body);

    const existing = await client.query(
      `SELECT id
         FROM request_auto_assignment_rules
        WHERE LOWER(request_type) = LOWER($1)
          AND COALESCE(warehouse_id, 0) = COALESCE($2::INT, 0)
        LIMIT 1`,
      [requestType, warehouseId],
    );

    const { rows } = existing.rowCount > 0
      ? await client.query(
          `UPDATE request_auto_assignment_rules
              SET assignee_user_id = $1,
                  is_active = $2,
                  updated_by = $3,
                  updated_at = NOW()
            WHERE id = $4
            RETURNING id, request_type, warehouse_id, assignee_user_id, is_active, created_at, updated_at`,
          [assigneeId, isActive, req.user.id, existing.rows[0].id],
        )
      : await client.query(
          `INSERT INTO request_auto_assignment_rules (
              request_type, warehouse_id, assignee_user_id, is_active, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id, request_type, warehouse_id, assignee_user_id, is_active, created_at, updated_at`,
          [requestType, warehouseId, assigneeId, isActive, req.user.id],
        );

    await client.query('COMMIT');
    return res.status(201).json({ rule: serializeRule(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.statusCode) {
      return next(err);
    }
    console.error('❌ Failed to save auto-assignment rule:', err);
    return next(createHttpError(500, 'Failed to save auto-assignment rule'));
  } finally {
    client.release();
  }
};

const updateAutoAssignmentRule = async (req, res, next) => {
  if (!canManageAutoAssignmentRules(req.user)) {
    return next(createHttpError(403, 'You do not have permission to manage auto-assignment rules'));
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(createHttpError(400, 'Invalid rule ID'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureRequestAutoAssignmentRulesTable(client);
    const { requestType, warehouseId, assigneeId, isActive } = await validateRulePayload(client, req.body);

    const duplicateCheck = await client.query(
      `SELECT id
         FROM request_auto_assignment_rules
        WHERE LOWER(request_type) = LOWER($1)
          AND COALESCE(warehouse_id, 0) = COALESCE($2::INT, 0)
          AND id <> $3`,
      [requestType, warehouseId, id],
    );
    if (duplicateCheck.rowCount > 0) {
      throw createHttpError(409, 'A rule already exists for this request type and warehouse');
    }

    const { rows } = await client.query(
      `UPDATE request_auto_assignment_rules
          SET request_type = $1,
              warehouse_id = $2,
              assignee_user_id = $3,
              is_active = $4,
              updated_by = $5,
              updated_at = NOW()
        WHERE id = $6
        RETURNING id, request_type, warehouse_id, assignee_user_id, is_active, created_at, updated_at`,
      [requestType, warehouseId, assigneeId, isActive, req.user.id, id],
    );

    if (rows.length === 0) {
      throw createHttpError(404, 'Auto-assignment rule not found');
    }

    await client.query('COMMIT');
    return res.json({ rule: serializeRule(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.statusCode) {
      return next(err);
    }
    console.error('❌ Failed to update auto-assignment rule:', err);
    return next(createHttpError(500, 'Failed to update auto-assignment rule'));
  } finally {
    client.release();
  }
};

const deleteAutoAssignmentRule = async (req, res, next) => {
  if (!canManageAutoAssignmentRules(req.user)) {
    return next(createHttpError(403, 'You do not have permission to manage auto-assignment rules'));
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(createHttpError(400, 'Invalid rule ID'));
  }

  try {
    await ensureRequestAutoAssignmentRulesTable();
    const result = await pool.query('DELETE FROM request_auto_assignment_rules WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return next(createHttpError(404, 'Auto-assignment rule not found'));
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete auto-assignment rule:', err);
    return next(createHttpError(500, 'Failed to delete auto-assignment rule'));
  }
};

module.exports = {
  listAutoAssignmentRules,
  upsertAutoAssignmentRule,
  updateAutoAssignmentRule,
  deleteAutoAssignmentRule,
};