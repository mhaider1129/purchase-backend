const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

const parseBoolean = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return Boolean(value);
};

const sanitizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError(400, 'At least one item is required');
  }

  return items.map((rawItem, idx) => {
    const item = rawItem || {};
    const itemName = typeof item.item_name === 'string' ? item.item_name.trim() : '';
    if (!itemName) {
      throw createHttpError(400, `Item ${idx + 1} is missing a valid name`);
    }

    const parsedQuantity = Number(
      typeof item.quantity === 'string' ? item.quantity.trim() : item.quantity,
    );
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      throw createHttpError(
        400,
        `Item ${idx + 1} must have a whole number quantity greater than 0`,
      );
    }

    const hasUnitCost =
      item.unit_cost !== undefined &&
      item.unit_cost !== null &&
      !(typeof item.unit_cost === 'string' && item.unit_cost.trim() === '');

    let parsedUnitCost = null;
    if (hasUnitCost) {
      const normalizedUnitCost =
        typeof item.unit_cost === 'string' ? item.unit_cost.trim() : item.unit_cost;
      const numericUnitCost = Number(normalizedUnitCost);

      if (!Number.isFinite(numericUnitCost) || numericUnitCost < 0) {
        throw createHttpError(
          400,
          `Item ${idx + 1} has an invalid unit cost; provide a non-negative whole number`,
        );
      }

      if (!Number.isInteger(numericUnitCost)) {
        throw createHttpError(
          400,
          `Item ${idx + 1} unit cost must be a whole number without decimals`,
        );
      }

      parsedUnitCost = numericUnitCost;
    }

    return {
      item_name: itemName,
      brand: item.brand || null,
      quantity: parsedQuantity,
      unit_cost: parsedUnitCost,
      total_cost: parsedUnitCost !== null ? parsedUnitCost * parsedQuantity : null,
      available_quantity: item.available_quantity || null,
      intended_use: item.intended_use || null,
      specs: item.specs || null,
    };
  });
};

const insertHistoricalRequest = async (req, res, next) => {
  let { items } = req.body;
  const requestType = typeof req.body.request_type === 'string'
    ? req.body.request_type.trim()
    : '';

  if (!requestType) {
    return next(createHttpError(400, 'Request type is required'));
  }

  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (err) {
      return next(createHttpError(400, 'Invalid items payload'));
    }
  }

  const sanitizedItems = (() => {
    try {
      return sanitizeItems(items);
    } catch (err) {
      return next(err);
    }
  })();

  if (!sanitizedItems) return; // Error already handled via next

  const departmentId = Number(
    typeof req.body.department_id === 'string'
      ? req.body.department_id.trim()
      : req.body.department_id,
  );
  if (!Number.isInteger(departmentId)) {
    return next(createHttpError(400, 'Department is required'));
  }

  const requesterIdCandidate = req.body.requester_id;
  let requesterId = null;
  if (requesterIdCandidate !== undefined && requesterIdCandidate !== null && requesterIdCandidate !== '') {
    const parsedRequesterId = Number(requesterIdCandidate);
    if (!Number.isInteger(parsedRequesterId)) {
      return next(createHttpError(400, 'Requester ID must be a valid integer'));
    }
    requesterId = parsedRequesterId;
  }

  const temporaryRequesterName = typeof req.body.temporary_requester_name === 'string'
    ? req.body.temporary_requester_name.trim()
    : '';

  if (!requesterId && !temporaryRequesterName) {
    return next(createHttpError(400, 'Provide a requester ID or a requester name'));
  }

  let projectId = null;
  const rawProjectId = req.body?.project_id;
  if (rawProjectId !== undefined && rawProjectId !== null && rawProjectId !== '') {
    const candidate = String(rawProjectId).trim();
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(candidate)) {
      return next(createHttpError(400, 'Invalid project selected'));
    }
    projectId = candidate;
  }

  const supplyWarehouseInput = req.body?.supply_warehouse_id;
  let supplyWarehouseId = null;
  if (requestType === 'Warehouse Supply') {
    if (supplyWarehouseInput === undefined || supplyWarehouseInput === null || supplyWarehouseInput === '') {
      return next(createHttpError(400, 'Select the warehouse fulfilling this supply request'));
    }

    const parsedWarehouseId = Number(supplyWarehouseInput);
    if (!Number.isInteger(parsedWarehouseId)) {
      return next(createHttpError(400, 'Supply warehouse must be a valid warehouse ID'));
    }

    supplyWarehouseId = parsedWarehouseId;
  }

  const markCompleted = parseBoolean(req.body.mark_completed || req.body.is_completed);

  const approvedAtInput = req.body.approved_at;
  const completionDateInput = req.body.completed_at || req.body.completion_date;

  const approvedAt = approvedAtInput ? new Date(approvedAtInput) : new Date();
  if (Number.isNaN(approvedAt.getTime())) {
    return next(createHttpError(400, 'Approved date is invalid'));
  }

  let completionDate = null;
  if (markCompleted) {
    completionDate = completionDateInput ? new Date(completionDateInput) : new Date();
    if (Number.isNaN(completionDate.getTime())) {
      return next(createHttpError(400, 'Completion date is invalid'));
    }
  }

  const estimatedCost =
    requestType === 'Stock'
      ? 0
      : sanitizedItems.reduce((sum, item) => {
          if (item.unit_cost === null || item.unit_cost === undefined) return sum;
          return sum + item.quantity * item.unit_cost;
        }, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deptRes = await client.query(
      'SELECT type FROM departments WHERE id = $1',
      [departmentId],
    );
    if (deptRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Department not found'));
    }

    let requestDomain = deptRes.rows[0]?.type?.toLowerCase() === 'medical'
      ? 'medical'
      : 'operational';

    if (requestType === 'Warehouse Supply' && supplyWarehouseId) {
      const warehouseRes = await client.query(
        `SELECT type FROM warehouses WHERE id = $1`,
        [supplyWarehouseId],
      );
      if (warehouseRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, 'Selected warehouse does not exist'));
      }
      const normalizedWarehouseType = warehouseRes.rows[0]?.type?.toLowerCase();
      if (normalizedWarehouseType === 'medical' || normalizedWarehouseType === 'operational') {
        requestDomain = normalizedWarehouseType;
      }
    }

    const requestRes = await client.query(
      `INSERT INTO requests (
        request_type, requester_id, department_id, justification, estimated_cost,
        status, request_domain, temporary_requester_name, completed_at, project_id, supply_warehouse_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        requestType,
        requesterId,
        departmentId,
        req.body.justification || null,
        estimatedCost,
        markCompleted ? 'completed' : 'approved',
        requestDomain,
        temporaryRequesterName || null,
        completionDate,
        projectId,
        supplyWarehouseId,
      ],
    );

    const requestId = requestRes.rows[0]?.id;
    if (!requestId) {
      await client.query('ROLLBACK');
      return next(createHttpError(500, 'Failed to create historical request'));
    }

    for (const item of sanitizedItems) {
      if (requestType === 'Warehouse Supply') {
        await client.query(
          `INSERT INTO warehouse_supply_items (request_id, item_name, quantity)
             VALUES ($1, $2, $3)`,
          [requestId, item.item_name, item.quantity],
        );
        continue;
      }

      await client.query(
        `INSERT INTO public.requested_items (
            request_id, item_name, brand, quantity, unit_cost, total_cost,
            available_quantity, intended_use, specs
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          requestId,
          item.item_name,
          item.brand,
          item.quantity,
          item.unit_cost,
          item.total_cost,
          item.available_quantity,
          item.intended_use,
          item.specs,
        ],
      );
    }

    await client.query(
      `INSERT INTO approvals (request_id, approver_id, approval_level, status, approved_at, is_active)
         VALUES ($1, $2, 1, 'Approved', $3, FALSE)`,
      [requestId, req.user.id || null, approvedAt],
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
         VALUES ($1, 'Imported Historical Request', $2, $3)`,
      [
        requestId,
        req.user.id,
        markCompleted
          ? 'Paper request recorded as completed for KPI analysis'
          : 'Paper request recorded as approved for KPI analysis',
      ],
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: '✅ Historical request recorded successfully',
      request_id: requestId,
      status: markCompleted ? 'completed' : 'approved',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to insert historical request:', err);
    if (err.statusCode || err.expose) {
      return next(err);
    }
    return next(createHttpError(500, 'Failed to insert historical request'));
  } finally {
    client.release();
  }
};

module.exports = { insertHistoricalRequest };