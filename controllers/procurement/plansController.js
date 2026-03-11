const path = require('path');
const fs = require('fs');
const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const {
  uploadBuffer,
  createSignedUrl,
} = require('../../utils/storage');
const {
  UPLOADS_DIR,
  isStoredLocally,
} = require('../../utils/attachmentPaths');
const sanitize = require('sanitize-filename');
const ensureProcurementPlanTables = require('../../utils/ensureProcurementPlanTables');

const PLANS_STORAGE_PREFIX = process.env.SUPABASE_PLANS_PREFIX || 'procurement-plans';

function handleStorageError(next, err) {
  console.error('❌ Procurement plan storage error:', err.message);
  if (err.code === 'SUPABASE_NOT_CONFIGURED') {
    return next(
      createHttpError(
        500,
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      )
    );
  }
  return next(createHttpError(500, 'Failed to upload procurement plan'));
}

function serializePlan(row) {
  if (!row) return row;

  const storedPath = (row.file_path || '').replace(/\\/g, '/');
  const isLocal = isStoredLocally(storedPath);
  let fileUrl = null;

  if (isLocal && storedPath) {
    fileUrl = `/${storedPath}`;
  } else if (row.id) {
    fileUrl = `/api/procurement-plans/${row.id}/download`;
  }

  return {
    ...row,
    file_path: storedPath,
    download_url: fileUrl,
  };
}

const parsePositiveNumber = (value, fieldLabel) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw createHttpError(400, `${fieldLabel} must be a positive number`);
  }
  return numeric;
};

const parseOptionalNumber = (value, fieldLabel) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw createHttpError(400, `${fieldLabel} must be a non-negative number`);
  }
  return numeric;
};

const uploadPlan = async (req, res, next) => {
  const department_id =
    req.body.department_id && req.body.department_id !== 'null'
      ? parseInt(req.body.department_id, 10)
      : req.user.department_id;
  const plan_year = parseInt(req.body.plan_year, 10);

  if (Number.isNaN(plan_year) || !req.file) {
    return next(createHttpError(400, 'plan_year and file are required'));
  }

  if (Number.isNaN(department_id)) {
    return next(createHttpError(400, 'department_id must be a valid number'));
  }

  try {
    const segments = [`department-${department_id}`, `year-${plan_year}`];
    const { objectKey } = await uploadBuffer({
      file: req.file,
      segments,
      prefix: PLANS_STORAGE_PREFIX,
    });

    const { rows } = await pool.query(
      `INSERT INTO procurement_plans (department_id, plan_year, file_name, file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [department_id, plan_year, req.file.originalname, objectKey]
    );

    res.status(201).json(serializePlan(rows[0]));
  } catch (err) {
    handleStorageError(next, err);
  }
};

const getPlans = async (req, res, next) => {
  const { department_id, year } = req.query;
  const values = [];
  let sql = 'SELECT * FROM procurement_plans WHERE 1=1';
  if (department_id) {
    values.push(department_id);
    sql += ` AND department_id = $${values.length}`;
  }
  if (year) {
    values.push(year);
    sql += ` AND plan_year = $${values.length}`;
  }
  sql += ' ORDER BY plan_year DESC';
  try {
    const result = await pool.query(sql, values);
    res.json(result.rows.map(serializePlan));
  } catch (err) {
    console.error('Failed to fetch procurement plans:', err);
    next(createHttpError(500, 'Failed to fetch procurement plans'));
  }
};

const getPlanById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM procurement_plans WHERE id=$1', [id]);
    if (result.rowCount === 0) return next(createHttpError(404, 'Plan not found'));
    res.json(serializePlan(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch procurement plan:', err);
    next(createHttpError(500, 'Failed to fetch procurement plan'));
  }
};

const getPlanForRequest = async (req, res, next) => {
  const { id } = req.params;
  try {
    const reqRes = await pool.query('SELECT department_id, created_at FROM requests WHERE id=$1', [id]);
    if (reqRes.rowCount === 0) return next(createHttpError(404, 'Request not found'));
    const { department_id, created_at } = reqRes.rows[0];
    const year = new Date(created_at).getFullYear();
    const planRes = await pool.query(
      'SELECT * FROM procurement_plans WHERE department_id=$1 AND plan_year=$2 LIMIT 1',
      [department_id, year]
    );
    if (planRes.rowCount === 0) return res.status(404).json({ message: 'No procurement plan found' });
    res.json(serializePlan(planRes.rows[0]));
  } catch (err) {
    console.error('Failed to match procurement plan:', err);
    next(createHttpError(500, 'Failed to match procurement plan'));
  }
};

const downloadPlan = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM procurement_plans WHERE id=$1', [id]);
    if (result.rowCount === 0) {
      return next(createHttpError(404, 'Plan not found'));
    }

    const plan = result.rows[0];
    const storedPath = plan.file_path || '';

    if (!storedPath || isStoredLocally(storedPath)) {
      const filename = storedPath
        ? path.basename(storedPath)
        : sanitize(plan.file_name || 'plan');
      const filePath = path.join(UPLOADS_DIR, filename);

      return fs.access(filePath, fs.constants.F_OK, err => {
        if (err) {
          console.warn('🟥 Procurement plan missing on disk:', filePath);
          return next(createHttpError(404, 'Plan file not found'));
        }
        res.download(filePath, filename);
      });
    }

    const signedUrl = await createSignedUrl(storedPath, { expiresIn: 120 });
    return res.redirect(signedUrl);
  } catch (err) {
    console.error('Failed to download procurement plan:', err);
    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }
    next(createHttpError(500, 'Failed to download procurement plan'));
  }
};

const createPlanItems = async (req, res, next) => {
  const { id } = req.params;
  const planId = parseInt(id, 10);
  const { items } = req.body;

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  if (!Array.isArray(items) || items.length === 0) {
    return next(createHttpError(400, 'items must be a non-empty array'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureProcurementPlanTables(client);

    const planRes = await client.query('SELECT id FROM procurement_plans WHERE id = $1', [planId]);
    if (planRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Plan not found'));
    }

    const inserted = [];

    for (const item of items) {
      const plannedQuantity = parsePositiveNumber(item.planned_quantity, 'planned_quantity');
      const plannedUnitCost = parseOptionalNumber(item.planned_unit_cost, 'planned_unit_cost');
      const plannedTotalCost =
        item.planned_total_cost === undefined || item.planned_total_cost === null
          ? plannedUnitCost !== null
            ? plannedUnitCost * plannedQuantity
            : null
          : parseOptionalNumber(item.planned_total_cost, 'planned_total_cost');

      if (!item.item_name) {
        throw createHttpError(400, 'item_name is required for each plan item');
      }

      const { rows } = await client.query(
        `INSERT INTO procurement_plan_items
          (plan_id, stock_item_id, item_name, description, unit_of_measure, planned_quantity,
           planned_unit_cost, planned_total_cost, currency, needed_by_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          planId,
          item.stock_item_id || null,
          item.item_name,
          item.description || null,
          item.unit_of_measure || null,
          plannedQuantity,
          plannedUnitCost,
          plannedTotalCost,
          item.currency || null,
          item.needed_by_date || null,
        ]
      );

      inserted.push(rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json(inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const getPlanItems = async (req, res, next) => {
  const { id } = req.params;
  const planId = parseInt(id, 10);

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  try {
    await ensureProcurementPlanTables();
    const { rows } = await pool.query(
      'SELECT * FROM procurement_plan_items WHERE plan_id = $1 ORDER BY id',
      [planId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch procurement plan items:', err);
    next(createHttpError(500, 'Failed to fetch procurement plan items'));
  }
};

const linkPlanItemRequests = async (req, res, next) => {
  const { id, itemId } = req.params;
  const planId = parseInt(id, 10);
  const planItemId = parseInt(itemId, 10);
  const { requested_item_ids = [], items = [] } = req.body;

  if (!Number.isInteger(planId) || !Number.isInteger(planItemId)) {
    return next(createHttpError(400, 'Plan id and item id must be valid numbers'));
  }

  const ids = [
    ...requested_item_ids,
    ...items.map(item => item.requested_item_id),
  ].filter(Boolean);

  if (ids.length === 0) {
    return next(createHttpError(400, 'requested_item_ids are required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureProcurementPlanTables(client);

    const planItemRes = await client.query(
      'SELECT id, plan_id FROM procurement_plan_items WHERE id = $1',
      [planItemId]
    );
    if (planItemRes.rowCount === 0 || planItemRes.rows[0].plan_id !== planId) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Plan item not found'));
    }

    const linked = [];
    for (const requestedItemId of ids) {
      const itemRes = await client.query(
        `SELECT id, request_id, quantity, unit_cost, total_cost
         FROM requested_items WHERE id = $1`,
        [requestedItemId]
      );
      if (itemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return next(createHttpError(404, `Requested item ${requestedItemId} not found`));
      }

      const requestedItem = itemRes.rows[0];
      const { rows } = await client.query(
        `INSERT INTO procurement_plan_item_requests
          (plan_item_id, request_id, requested_item_id, quantity, unit_cost, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (plan_item_id, requested_item_id)
         DO UPDATE SET
           request_id = EXCLUDED.request_id,
           quantity = EXCLUDED.quantity,
           unit_cost = EXCLUDED.unit_cost,
           total_cost = EXCLUDED.total_cost
         RETURNING *`,
        [
          planItemId,
          requestedItem.request_id,
          requestedItem.id,
          requestedItem.quantity,
          requestedItem.unit_cost,
          requestedItem.total_cost,
        ]
      );

      linked.push(rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json(linked);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const linkPlanItemConsumptions = async (req, res, next) => {
  const { id, itemId } = req.params;
  const planId = parseInt(id, 10);
  const planItemId = parseInt(itemId, 10);
  const { warehouse_stock_movement_ids = [], department_stock_movement_ids = [] } = req.body;

  if (!Number.isInteger(planId) || !Number.isInteger(planItemId)) {
    return next(createHttpError(400, 'Plan id and item id must be valid numbers'));
  }

  const movementIds = [
    ...warehouse_stock_movement_ids.map(idValue => ({ idValue, type: 'warehouse' })),
    ...department_stock_movement_ids.map(idValue => ({ idValue, type: 'department' })),
  ];

  if (movementIds.length === 0) {
    return next(createHttpError(400, 'movement ids are required'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureProcurementPlanTables(client);

    const planItemRes = await client.query(
      'SELECT id, plan_id FROM procurement_plan_items WHERE id = $1',
      [planItemId]
    );
    if (planItemRes.rowCount === 0 || planItemRes.rows[0].plan_id !== planId) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Plan item not found'));
    }

    const linked = [];
    for (const movement of movementIds) {
      if (movement.type === 'warehouse') {
        const movementRes = await client.query(
          `SELECT id, direction, quantity FROM warehouse_stock_movements WHERE id = $1`,
          [movement.idValue]
        );
        if (movementRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return next(createHttpError(404, `Warehouse stock movement ${movement.idValue} not found`));
        }
        if (movementRes.rows[0].direction !== 'out') {
          await client.query('ROLLBACK');
          return next(createHttpError(400, 'Only outbound warehouse movements can be linked'));
        }

        const { rows } = await client.query(
          `INSERT INTO procurement_plan_item_consumptions
            (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id, quantity)
           VALUES ($1,$2,NULL,$3)
           ON CONFLICT (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id)
           DO UPDATE SET quantity = EXCLUDED.quantity
           RETURNING *`,
          [planItemId, movement.idValue, movementRes.rows[0].quantity]
        );
        linked.push(rows[0]);
      } else {
        const movementRes = await client.query(
          `SELECT id, direction, quantity FROM department_stock_movements WHERE id = $1`,
          [movement.idValue]
        );
        if (movementRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return next(createHttpError(404, `Department stock movement ${movement.idValue} not found`));
        }
        if (movementRes.rows[0].direction !== 'out') {
          await client.query('ROLLBACK');
          return next(createHttpError(400, 'Only outbound department movements can be linked'));
        }

        const { rows } = await client.query(
          `INSERT INTO procurement_plan_item_consumptions
            (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id, quantity)
           VALUES ($1,NULL,$2,$3)
           ON CONFLICT (plan_item_id, warehouse_stock_movement_id, department_stock_movement_id)
           DO UPDATE SET quantity = EXCLUDED.quantity
           RETURNING *`,
          [planItemId, movement.idValue, movementRes.rows[0].quantity]
        );
        linked.push(rows[0]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(linked);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const getPlanItemVariance = async (req, res, next) => {
  const { id } = req.params;
  const planId = parseInt(id, 10);

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  try {
    await ensureProcurementPlanTables();
    const { rows } = await pool.query(
      `SELECT
        ppi.*,
        COALESCE(req_totals.requested_quantity, 0) AS requested_quantity,
        COALESCE(req_totals.requested_cost, 0) AS requested_cost,
        COALESCE(cons_totals.consumed_quantity, 0) AS consumed_quantity,
        COALESCE(req_totals.requested_quantity, 0) - ppi.planned_quantity AS request_quantity_variance,
        COALESCE(cons_totals.consumed_quantity, 0) - ppi.planned_quantity AS consumption_quantity_variance
       FROM procurement_plan_items ppi
       LEFT JOIN (
         SELECT plan_item_id,
           SUM(quantity) AS requested_quantity,
           SUM(total_cost) AS requested_cost
         FROM procurement_plan_item_requests
         GROUP BY plan_item_id
       ) req_totals ON req_totals.plan_item_id = ppi.id
       LEFT JOIN (
         SELECT plan_item_id,
           SUM(quantity) AS consumed_quantity
         FROM procurement_plan_item_consumptions
         GROUP BY plan_item_id
       ) cons_totals ON cons_totals.plan_item_id = ppi.id
       WHERE ppi.plan_id = $1
       ORDER BY ppi.id`,
      [planId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch procurement plan variance:', err);
    next(createHttpError(500, 'Failed to fetch procurement plan variance'));
  }
};

module.exports = {
  uploadPlan,
  getPlans,
  getPlanById,
  getPlanForRequest,
  downloadPlan,
  createPlanItems,
  getPlanItems,
  linkPlanItemRequests,
  linkPlanItemConsumptions,
  getPlanItemVariance,
};