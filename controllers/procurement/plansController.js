const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const {
  uploadBuffer,
} = require('../../utils/storage');
const {
  isStoredLocally,
} = require('../../utils/attachmentPaths');
const ensureProcurementPlanTables = require('../../utils/ensureProcurementPlanTables');

const { createPlanningAuthorization, has, id: recordId } = require('../../services/planningAuthorizationService');
const authority = createPlanningAuthorization();
const withTransaction = require('../../utils/withTransaction');
const { writeAuditEvent } = require('../../services/auditService');
const fileStorage = require('../../services/attachmentStorageAdapter');
const audit = (client, actor, entityType, afterData, action, beforeData = null) => writeAuditEvent({
  client, actorUserId: actor.id, instituteId: actor.institute_id, entityType,
  entityId: afterData.id, action, beforeData, afterData,
});
const PLANS_STORAGE_PREFIX = process.env.SUPABASE_PLANS_PREFIX || 'procurement-plans';

function handleStorageError(next, err) {
  if(err.statusCode)return next(err);
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
    fileUrl = `/api/procurement-plans/${row.id}/download`;
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

const uploadPlan = async (req,res,next) => {
  let objectKey;
  try {
    const actor = await authority.actor(req.user, 'manage');
    const departmentId = recordId(req.body.department_id || actor.department_id);
    const year = Number(req.body.plan_year);
    if (!Number.isInteger(year) || !req.file) throw createHttpError(400, 'plan_year and file are required');
    await authority.department(actor, departmentId);
    ({ objectKey } = await uploadBuffer({ file: req.file, segments: [`department-${departmentId}`, `year-${year}`], prefix: PLANS_STORAGE_PREFIX }));
    const plan = await withTransaction(async client => {
      const current = await authority.actor(req.user, 'manage', client);
      await authority.department(current, departmentId, client);
      const row = (await client.query('INSERT INTO procurement_plans(department_id,plan_year,file_name,file_path) VALUES($1,$2,$3,$4) RETURNING *', [departmentId,year,req.file.originalname,objectKey])).rows[0];
      await audit(client,current,'procurement_plan',row,'planning.plan.uploaded'); return row;
    });
    res.status(201).json(serializePlan(plan));
  } catch (err) {
    if (objectKey) { try { await fileStorage.remove({ file_path: objectKey }); } catch (_) { console.error('Planning upload cleanup deferred'); } }
    handleStorageError(next,err);
  }
};
const getPlans = async (req,res,next) => {
  try {
    const actor = await authority.actor(req.user);
    if (req.query.year != null && !Number.isInteger(Number(req.query.year))) throw createHttpError(400,'year must be an integer');
    if (req.query.department_id) await authority.department(actor, req.query.department_id);
    const { rows } = await pool.query(`SELECT p.* FROM procurement_plans p JOIN departments d ON d.id=p.department_id
      WHERE d.institute_id=$1 AND ($2::boolean OR d.id=ANY($3::integer[]))
      AND ($4::integer IS NULL OR p.department_id=$4) AND ($5::integer IS NULL OR p.plan_year=$5) ORDER BY p.plan_year DESC,p.id`,
      [actor.institute_id,has(actor,'planning.cross-department'),actor.departmentIds,req.query.department_id || null,req.query.year || null]);
    res.json(rows.map(serializePlan));
  } catch (err) { next(err); }
};
const getPlanById = async (req,res,next) => {
  try { res.json(serializePlan(await authority.plan(await authority.actor(req.user),req.params.id))); }
  catch (err) { next(err); }
};
const getPlanForRequest = async (req,res,next) => {
  try {
    const actor = await authority.actor(req.user);
    const request = (await pool.query('SELECT department_id,created_at FROM requests WHERE id=$1 AND institute_id=$2', [recordId(req.params.id),actor.institute_id])).rows[0];
    if (!request) throw createHttpError(404, 'Planning record or reference not found');
    await authority.department(actor,request.department_id);
    const plan = (await pool.query('SELECT * FROM procurement_plans WHERE department_id=$1 AND plan_year=$2 ORDER BY id DESC LIMIT 1', [request.department_id,new Date(request.created_at).getFullYear()])).rows[0];
    if (!plan) return res.status(404).json({ message: 'No procurement plan found' });
    res.json(serializePlan(plan));
  } catch (err) { next(err); }
};
const downloadPlan = async (req,res,next) => {
  try { return fileStorage.download(await authority.plan(await authority.actor(req.user),req.params.id),req,res,next); }
  catch (err) { next(err); }
};

const createPlanItems = async (req, res, next) => {
  const { id } = req.params;
  const planId = Number(id);
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
    const actor = await authority.actor(req.user, 'manage', client);
    const plan = await authority.plan(actor, planId, 'manage', client);
    await ensureProcurementPlanTables(client);

    const inserted = [];

    for (const item of items) {
      if (item.stock_item_id) await authority.stock(actor,item.stock_item_id,{ departmentId: plan.department_id },client);
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

      await audit(client,actor,'procurement_plan_item',rows[0],'planning.item.created');
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
  const planId = Number(id);

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  try {
    const result = await withTransaction(async client => {
      const actor = await authority.actor(req.user,'read',client);
      const plan = await authority.plan(actor,planId,'read',client);
      await ensureProcurementPlanTables(client);
      const { rows } = await client.query(
        'SELECT * FROM procurement_plan_items WHERE plan_id = $1 ORDER BY id',
        [planId]
      );
      for (const item of rows) if (item.stock_item_id) await authority.stock(actor,item.stock_item_id,{ departmentId: plan.department_id },client);
      return rows;
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch procurement plan items:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to fetch procurement plan items'));
  }
};

const linkPlanItemRequests = async (req, res, next) => {
  const { id, itemId } = req.params;
  const planId = Number(id);
  const planItemId = Number(itemId);
  const { requested_item_ids = [], items = [] } = req.body;

  if (!Number.isInteger(planId) || !Number.isInteger(planItemId)) {
    return next(createHttpError(400, 'Plan id and item id must be valid numbers'));
  }

  if (!Array.isArray(requested_item_ids) || !Array.isArray(items)) return next(createHttpError(400,'Request links must be arrays'));
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
    const actor = await authority.actor(req.user, 'manage', client);
    const plan = await authority.plan(actor,planId,'manage',client);
    await ensureProcurementPlanTables(client);
    const planItem = await authority.planItem(actor,planId,planItemId,client);

    const linked = [];
    for (const requestedItemId of [...new Set(ids.map(recordId))].sort((a,b)=>a-b)) {
      const requestedItem = await authority.requestedItem(actor,requestedItemId,plan.department_id,client);
      if (planItem.stock_item_id && requestedItem.stock_item_id && Number(planItem.stock_item_id)!==Number(requestedItem.stock_item_id)) throw createHttpError(400,'Linked item identity does not match plan item');
      const before = (await client.query('SELECT * FROM procurement_plan_item_requests WHERE plan_item_id=$1 AND requested_item_id=$2 FOR UPDATE',[planItemId,requestedItemId])).rows[0] || null;
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

      await audit(client,actor,'procurement_plan_item_request',rows[0],'planning.request.linked',before);
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
  const planId = Number(id);
  const planItemId = Number(itemId);
  const { warehouse_stock_movement_ids = [], department_stock_movement_ids = [] } = req.body;

  if (!Number.isInteger(planId) || !Number.isInteger(planItemId)) {
    return next(createHttpError(400, 'Plan id and item id must be valid numbers'));
  }

  if (!Array.isArray(warehouse_stock_movement_ids) || !Array.isArray(department_stock_movement_ids)) return next(createHttpError(400,'Movement links must be arrays'));
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
    const actor = await authority.actor(req.user, 'manage', client);
    const plan = await authority.plan(actor,planId,'manage',client);
    await ensureProcurementPlanTables(client);
    const planItem = await authority.planItem(actor,planId,planItemId,client);

    const linked = [];
    const unique = new Map(movementIds.map(m => [`${m.type}:${recordId(m.idValue)}`,m]));
    for (const movement of unique.values()) {
      const source = await authority.movement(actor,movement.type,movement.idValue,plan.department_id,client);
      if (planItem.stock_item_id && source.stock_item_id && Number(planItem.stock_item_id)!==Number(source.stock_item_id)) throw createHttpError(400,'Consumption identity does not match plan item');
      const column = movement.type==='warehouse' ? 'warehouse_stock_movement_id' : 'department_stock_movement_id';
      const before = (await client.query(`SELECT * FROM procurement_plan_item_consumptions WHERE plan_item_id=$1 AND ${column}=$2 FOR UPDATE`,[planItemId,movement.idValue])).rows[0];
      const row = before
        ? (await client.query('UPDATE procurement_plan_item_consumptions SET quantity=$1 WHERE id=$2 RETURNING *',[source.quantity,before.id])).rows[0]
        : (await client.query(`INSERT INTO procurement_plan_item_consumptions(plan_item_id,${column},quantity) VALUES($1,$2,$3) RETURNING *`,[planItemId,movement.idValue,source.quantity])).rows[0];
      await audit(client,actor,'procurement_plan_item_consumption',row,'planning.consumption.linked',before || null);
      linked.push(row);
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
  const planId = Number(id);

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  try {
    const result = await withTransaction(async client => {
      const actor = await authority.actor(req.user,'read',client);
      const plan = await authority.plan(actor,planId,'read',client);
      await ensureProcurementPlanTables(client);
      await authority.validateLinks(actor,plan,client);
      const { rows } = await client.query(
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
      return rows;
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch procurement plan variance:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to fetch procurement plan variance'));
  }
};


const getPlanIntegrationInsights = async (req, res, next) => {
  const { id } = req.params;
  const planId = Number(id);

  if (!Number.isInteger(planId)) {
    return next(createHttpError(400, 'Plan id must be a valid number'));
  }

  try {
    const result = await withTransaction(async client => {
      const actor = await authority.actor(req.user,'read',client);
      const plan = await authority.plan(actor,planId,'read',client);
      await ensureProcurementPlanTables(client);
      await authority.validateLinks(actor,plan,client);
      const { rows } = await client.query(
        `WITH plan_items AS (
           SELECT ppi.id, ppi.plan_id, ppi.stock_item_id, ppi.item_name, ppi.planned_quantity,
                  ppi.needed_by_date, pp.department_id
           FROM procurement_plan_items ppi
           JOIN procurement_plans pp ON pp.id = ppi.plan_id
           WHERE ppi.plan_id = $1
         ),
         request_history AS (
           SELECT pi.id AS plan_item_id,
                  COALESCE(SUM(CASE WHEN r.created_at >= (CURRENT_DATE - INTERVAL '365 days') THEN pir.quantity ELSE 0 END), 0) AS requested_qty_12m,
                  COALESCE(SUM(CASE WHEN r.created_at >= (CURRENT_DATE - INTERVAL '90 days') THEN pir.quantity ELSE 0 END), 0) AS requested_qty_90d
           FROM plan_items pi
           LEFT JOIN procurement_plan_item_requests pir ON pir.plan_item_id = pi.id
           LEFT JOIN requests r ON r.id = pir.request_id
           GROUP BY pi.id
         ),
         seasonal AS (
           SELECT pi.id AS plan_item_id,NULL::numeric AS seasonal_avg_next_3m,NULL::numeric AS monthly_avg FROM plan_items pi
         ),
         replenishment AS (
           SELECT pi.id AS plan_item_id,
                  COALESCE(AVG(wrp.reorder_point), 0) AS reorder_point,
                  COALESCE(AVG(wrp.safety_stock), 0) AS safety_stock,
                  COALESCE(AVG(wrp.lead_time_days), 0) AS lead_time_days
           FROM plan_items pi
           LEFT JOIN warehouse_replenishment_policies wrp
             ON wrp.stock_item_id = pi.stock_item_id AND wrp.is_active = true
             AND EXISTS(SELECT 1 FROM warehouses w LEFT JOIN departments wd ON wd.id=w.department_id WHERE w.id=wrp.warehouse_id AND w.institute_id=$2 AND (w.department_id IS NULL OR wd.institute_id=w.institute_id)
               AND ($3::boolean OR w.id=ANY($4::integer[]) OR w.department_id=$5))
           GROUP BY pi.id
         )
         SELECT
           pi.id AS plan_item_id,
           pi.stock_item_id,
           pi.item_name,
           pi.planned_quantity,
           pi.needed_by_date,
           rh.requested_qty_12m,
           rh.requested_qty_90d,
           s.monthly_avg AS consumption_monthly_avg,
           s.seasonal_avg_next_3m,
           r.reorder_point,
           r.safety_stock,
           r.lead_time_days,
           (rh.requested_qty_12m / 12.0) AS demand_monthly_avg,
           GREATEST(0, r.reorder_point + r.safety_stock - pi.planned_quantity) AS reorder_gap,
           CASE
             WHEN s.monthly_avg > 0 THEN ROUND((s.seasonal_avg_next_3m / s.monthly_avg)::numeric, 3)
             ELSE 1
           END AS seasonal_index,
           ROUND((rh.requested_qty_90d / 90.0 * COALESCE(NULLIF(r.lead_time_days, 0), 14))::numeric, 2) AS lead_time_demand,
           ROUND((pi.planned_quantity - (rh.requested_qty_12m / 12.0))::numeric, 2) AS plan_vs_demand_gap
         FROM plan_items pi
         LEFT JOIN request_history rh ON rh.plan_item_id = pi.id
         LEFT JOIN seasonal s ON s.plan_item_id = pi.id
         LEFT JOIN replenishment r ON r.plan_item_id = pi.id
         ORDER BY pi.id`,
        [planId,actor.institute_id,has(actor,'planning.cross-warehouse'),actor.warehouseIds,actor.department_id || null]
      );

      const items = rows.map(row => ({
        ...row,
        recommended_actions: [
          row.reorder_gap > 0 ? 'Increase planned quantity to cover reorder point and safety stock.' : null,
          row.lead_time_days > 0 ? `Start sourcing at least ${Math.ceil(Number(row.lead_time_days))} days before need-by date.` : null,
          Number(row.seasonal_index) > 1.1 ? 'Apply seasonal uplift for upcoming months.' : null,
          Number(row.plan_vs_demand_gap) < 0 ? 'Current plan trails average demand; review budget allocation.' : null,
        ].filter(Boolean),
      }));

      return {
        plan_id: planId,
        data_limitations: ['Unscoped monthly dispensing history is excluded; seasonal usage is unavailable until ownership is established.'],
        generated_at: new Date().toISOString(),
        integration_dimensions: [
          'consumption_history',
          'reorder_engine',
          'demand_planning',
          'supplier_lead_time',
          'seasonal_usage',
        ],
        items,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Failed to build procurement planning integration insights:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to build procurement planning integration insights'));
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
  getPlanIntegrationInsights,
};