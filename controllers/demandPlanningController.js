
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const withTransaction = require('../utils/withTransaction');
const { writeAuditEvent } = require('../services/auditService');
const { createPlanningAuthorization, has } = require('../services/planningAuthorizationService');
const authority = createPlanningAuthorization();
const audit = (client, actor, entityType, beforeData, afterData, action) => writeAuditEvent({
  client, actorUserId: actor.id, instituteId: actor.institute_id, entityType,
  entityId: afterData.id, action, beforeData, afterData,
});
const positiveInteger = (value, name, max = 3650) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw createHttpError(400, `${name} must be a positive integer no greater than ${max}`);
  return n;
};
const nonNegative = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw createHttpError(400, `${name} must be non-negative`);
  return n;
};
async function inputScope(req, actor, db = pool) {
  if (req.body?.department_id != null) await authority.department(actor, req.body.department_id, db);
  const warehouseId = req.body?.warehouse_id ?? req.query?.warehouse_id;
  if (warehouseId != null && warehouseId !== '') await authority.warehouse(actor, warehouseId, db);
  return warehouseId == null || warehouseId === '' ? null : Number(warehouseId);
}


const DEFAULT_HISTORY_MONTHS = 12;
const DEFAULT_PLANNING_SETTINGS = {
  forecast_horizon_months: 6,
  forecast_window_size: 3,
  safety_lead_time_days: 14,
  safety_review_period_days: 7,
  demand_history_days: 120,
  demand_history_months: 12,
  safety_history_days: 180,
  mrp_horizon_days: 84,
  mrp_bucket_days: 7,
};

const zTable = [
  { level: 0.80, z: 0.84 },
  { level: 0.85, z: 1.04 },
  { level: 0.90, z: 1.28 },
  { level: 0.95, z: 1.65 },
  { level: 0.97, z: 1.88 },
  { level: 0.98, z: 2.05 },
  { level: 0.99, z: 2.33 },
];

function clampServiceLevel(level) {
  if (Number.isNaN(level)) return 0.95;
  return Math.min(Math.max(level, 0.5), 0.999);
}

function interpolateZ(serviceLevel) {
  const level = clampServiceLevel(serviceLevel);
  for (let i = 0; i < zTable.length - 1; i += 1) {
    const lower = zTable[i];
    const upper = zTable[i + 1];
    if (level >= lower.level && level <= upper.level) {
      const slope = (upper.z - lower.z) / (upper.level - lower.level);
      return lower.z + slope * (level - lower.level);
    }
  }
  return zTable[zTable.length - 1].z;
}

function mean(values) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function getNextMonthLabel(fromLabel, offset) {
  const [yearStr, monthStr] = (fromLabel || '').split('-');
  const baseDate = new Date();
  baseDate.setUTCFullYear(parseInt(yearStr, 10) || baseDate.getUTCFullYear());
  baseDate.setUTCMonth((parseInt(monthStr, 10) || 1) - 1);
  baseDate.setUTCDate(1);
  baseDate.setUTCMonth(baseDate.getUTCMonth() + offset);
  const year = baseDate.getUTCFullYear();
  const month = `${baseDate.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function movingAverage(history, horizon, windowSize = 3) {
  const quantities = history.map(entry => Number(entry.quantity) || 0);
  const lastLabel = history[history.length - 1]?.bucket || getNextMonthLabel(null, 0);
  const forecast = [];

  for (let i = 1; i <= horizon; i += 1) {
    const relevant = quantities.slice(-windowSize);
    const value = relevant.length ? mean(relevant) : 0;
    forecast.push({ month: getNextMonthLabel(lastLabel, i), forecast_qty: Number(value.toFixed(2)) });
    quantities.push(value);
  }

  return forecast;
}

function linearTrend(history, horizon) {
  if (!history.length) return movingAverage(history, horizon, 1);
  const values = history.map(entry => Number(entry.quantity) || 0);
  const n = values.length;
  const xValues = values.map((_, index) => index + 1);
  const sumX = xValues.reduce((acc, value) => acc + value, 0);
  const sumY = values.reduce((acc, value) => acc + value, 0);
  const sumXY = values.reduce((acc, value, index) => acc + value * xValues[index], 0);
  const sumX2 = xValues.reduce((acc, value) => acc + value ** 2, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2 || 1);
  const intercept = sumY / n - slope * (sumX / n);

  const lastLabel = history[history.length - 1]?.bucket || getNextMonthLabel(null, 0);
  const forecast = [];
  for (let i = 1; i <= horizon; i += 1) {
    const x = n + i;
    const value = Math.max(intercept + slope * x, 0);
    forecast.push({ month: getNextMonthLabel(lastLabel, i), forecast_qty: Number(value.toFixed(2)) });
  }
  return forecast;
}

function applySopAdjustments(forecast, sopAdjustments = []) {
  if (!Array.isArray(sopAdjustments) || !sopAdjustments.length) return forecast;

  const adjustments = sopAdjustments.reduce((acc, item) => {
    if (item && item.period) {
      acc[item.period] = Number(item.adjustment) || 0;
    }
    return acc;
  }, {});

  return forecast.map(entry => ({
    ...entry,
    forecast_qty: Number((entry.forecast_qty + (adjustments[entry.month] || 0)).toFixed(2)),
  }));
}

function buildIndexedFactorMap(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((acc, entry) => {
    if (!entry || !entry.period) return acc;
    acc[entry.period] = Number(entry.factor ?? entry.multiplier ?? entry.value);
    return acc;
  }, {});
}

function clampFactor(rawFactor, fallback = 1) {
  const numeric = Number(rawFactor);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) return fallback;
  return Math.max(numeric, 0);
}

function applyAdvancedDemandAdjustments(forecast, options = {}) {
  const {
    seasonality = [],
    department_activity = [],
    oncology_protocols = [],
    stock_outs = [],
    min_monthly_stock = null,
    max_monthly_stock = null,
  } = options;

  const seasonalityByMonth = buildIndexedFactorMap(seasonality);
  const departmentByMonth = buildIndexedFactorMap(department_activity);
  const oncologyByMonth = buildIndexedFactorMap(oncology_protocols);
  const stockOutByMonth = buildIndexedFactorMap(stock_outs);
  const minStock = min_monthly_stock == null ? null : Number(min_monthly_stock);
  const maxStock = max_monthly_stock == null ? null : Number(max_monthly_stock);

  return forecast.map(entry => {
    const base = Number(entry.forecast_qty) || 0;
    const month = entry.month;
    const seasonalityFactor = clampFactor(seasonalityByMonth[month], 1);
    const departmentFactor = clampFactor(departmentByMonth[month], 1);
    const oncologyFactor = clampFactor(oncologyByMonth[month], 1);
    const stockOutCorrection = clampFactor(stockOutByMonth[month], 1);
    const multiplier = seasonalityFactor * departmentFactor * oncologyFactor * stockOutCorrection;
    let adjusted = base * multiplier;

    if (!Number.isNaN(minStock) && minStock >= 0) adjusted = Math.max(adjusted, minStock);
    if (!Number.isNaN(maxStock) && maxStock >= 0) adjusted = Math.min(adjusted, maxStock);

    return {
      ...entry,
      forecast_qty: Number(adjusted.toFixed(2)),
      driver_factors: {
        seasonality: seasonalityFactor,
        department_activity: departmentFactor,
        oncology_protocols: oncologyFactor,
        stock_out_correction: stockOutCorrection,
      },
    };
  });
}

// Name-only monthly_dispensing has no trusted institute/department ownership.
// Use owned request history; never infer an institute from facility-name text or
// the current placement of a historical importer.
const demandScope = `r.institute_id=$3 AND ($4::boolean OR r.department_id=ANY($5::int[]))
  AND ($6::integer IS NULL OR r.warehouse_id=$6)
  AND (r.warehouse_id IS NULL OR EXISTS(SELECT 1 FROM warehouses w LEFT JOIN departments wd ON wd.id=w.department_id WHERE w.id=r.warehouse_id AND w.institute_id=$3 AND (w.department_id IS NULL OR wd.institute_id=w.institute_id)
    AND ($7::boolean OR w.id=ANY($8::int[]) OR w.department_id=$9)))
  AND ($10::integer IS NULL OR r.department_id=$10)`;
const demandParams = (itemName, period, actor, warehouseId, departmentId) => [itemName, period,
  actor.institute_id, has(actor,'planning.cross-department'), actor.departmentIds, warehouseId,
  has(actor,'planning.cross-warehouse'), actor.warehouseIds, actor.department_id || null, departmentId || null];
async function fetchMonthlyDemand(itemName, months, actor, warehouseId, departmentId) {
  const { rows } = await pool.query(
    `SELECT TO_CHAR(r.created_at,'YYYY-MM') AS bucket,COALESCE(SUM(ri.quantity),0) AS quantity
     FROM requested_items ri JOIN requests r ON r.id=ri.request_id
     JOIN departments d ON d.id=r.department_id AND d.institute_id=r.institute_id
     WHERE ri.item_name ILIKE $1 AND r.created_at >= CURRENT_DATE-($2 || ' months')::interval AND ${demandScope}
     GROUP BY bucket ORDER BY bucket`, demandParams(itemName, months, actor, warehouseId, departmentId));
  return { history: rows.map(row => ({ bucket: row.bucket, quantity: Number(row.quantity) || 0 })), source: 'requests' };
}
async function fetchDailyDemand(itemName, days, actor, warehouseId, departmentId) {
  const { rows } = await pool.query(
    `SELECT r.created_at::date AS bucket_date,COALESCE(SUM(ri.quantity),0) AS quantity
     FROM requested_items ri JOIN requests r ON r.id=ri.request_id
     JOIN departments d ON d.id=r.department_id AND d.institute_id=r.institute_id
     WHERE ri.item_name ILIKE $1 AND r.created_at >= CURRENT_DATE-($2 || ' days')::interval AND ${demandScope}
     GROUP BY bucket_date ORDER BY bucket_date`, demandParams(itemName, days, actor, warehouseId, departmentId));
  return rows.map(row => ({ day: row.bucket_date, quantity: Number(row.quantity) || 0 }));
}
async function ensurePlanningSettingsTable(db = pool) {
  const result = await db.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='planning_settings' AND column_name='institute_id') AND to_regclass('public.planning_settings_institute_warehouse_key') IS NOT NULL AS planning_scope_available`);
  if (result.rows[0]?.planning_scope_available !== true) throw Object.assign(createHttpError(503, 'Apply the complete manual SQL 056 planning authorization patch before using planning defaults'), { code: 'PLANNING_SCOPE_SCHEMA_REQUIRED' });
}
async function getPlanningSettings(warehouseId, actor, db = pool) {
  await ensurePlanningSettingsTable(db);
  const { rows } = await db.query('SELECT * FROM planning_settings WHERE institute_id=$1 AND COALESCE(warehouse_id,-1)=COALESCE($2::bigint,-1) LIMIT 1', [actor.institute_id, warehouseId]);
  return { ...DEFAULT_PLANNING_SETTINGS, ...(rows[0] || {}), defaults_scope: rows.length ? 'institute_owned' : 'built_in' };
}

const getDemandForecast = async (req, res, next) => {
  const {
    item_name: itemName,
    warehouse_id: warehouseId = null,
    method = 'moving_average',
    horizon_months: providedHorizonMonths,
    window_size: providedWindowSize,
    sop_adjustments: sopAdjustments = [],
    seasonality = [],
    oncology_protocols = [],
    department_activity = [],
    stock_outs = [],
    min_monthly_stock = null,
    max_monthly_stock = null,
  } = req.body;

  if (!itemName) {
    return next(createHttpError(400, 'item_name is required'));
  }

  try {
    const actor = await authority.actor(req.user);
    await inputScope(req, actor);
    const settings = await getPlanningSettings(warehouseId, actor);
    const horizonMonths = providedHorizonMonths ?? settings.forecast_horizon_months;
    const windowSize = providedWindowSize ?? settings.forecast_window_size;
    const { history, source: historySource } = await fetchMonthlyDemand(itemName, settings.demand_history_months || DEFAULT_HISTORY_MONTHS, actor, warehouseId, req.body.department_id);
    const horizon = positiveInteger(horizonMonths, 'horizon_months', 120);
    if (Number.isNaN(horizon) || horizon <= 0) {
      return next(createHttpError(400, 'horizon_months must be a positive number'));
    }
    let forecast;

    if (method === 'linear_trend') {
      forecast = linearTrend(history, horizon);
    } else {
      forecast = movingAverage(history, horizon, Number(windowSize) || 3);
    }

    const adjustedForSop = applySopAdjustments(forecast, sopAdjustments);
    const adjustedForecast = applyAdvancedDemandAdjustments(adjustedForSop, {
      seasonality,
      oncology_protocols,
      department_activity,
      stock_outs,
      min_monthly_stock,
      max_monthly_stock,
    });

    res.json({
      item_name: itemName,
      method,
      horizon_months: horizon,
      history,
      history_source: historySource,
      forecast: adjustedForecast,
      assumptions: {
        window_size: Number(windowSize) || 3,
        sop_adjustments: sopAdjustments,
        seasonality,
        oncology_protocols,
        department_activity,
        stock_outs,
        min_monthly_stock,
        max_monthly_stock,
      },
    });
  } catch (err) {
    console.error('❌ Demand forecast failed:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to generate demand forecast'));
  }
};

const calculateSafetyStock = async (req, res, next) => {
  const {
    item_name: itemName,
    service_level: rawServiceLevel = 0.95,
    on_hand = 0,
    on_order = 0,
  } = req.body;

  if (!itemName) {
    return next(createHttpError(400, 'item_name is required'));
  }

  try {
    const actor = await authority.actor(req.user);
    const warehouseId = await inputScope(req, actor);
    const settings = await getPlanningSettings(warehouseId, actor);
    const leadTimeDays = req.body.lead_time_days ?? settings.safety_lead_time_days;
    const reviewPeriodDays = req.body.review_period_days ?? settings.safety_review_period_days;
    const dailyDemand = await fetchDailyDemand(itemName, settings.safety_history_days || 180, actor, warehouseId, req.body.department_id);
    const dailyValues = dailyDemand.map(entry => entry.quantity);
    const avgDaily = mean(dailyValues);
    const stdDaily = std(dailyValues);
    const cycleDays = Number(leadTimeDays) + Number(reviewPeriodDays);
    const serviceLevel = clampServiceLevel(Number(rawServiceLevel));
    const z = interpolateZ(serviceLevel);
    const safetyStock = Number((z * stdDaily * Math.sqrt(Math.max(cycleDays, 1))).toFixed(2));
    const reorderPoint = Number((avgDaily * cycleDays + safetyStock).toFixed(2));
    const projectedGap = reorderPoint - (Number(on_hand) + Number(on_order));

    res.json({
      item_name: itemName,
      service_level: serviceLevel,
      z_value: Number(z.toFixed(3)),
      average_daily_demand: Number(avgDaily.toFixed(2)),
      demand_std_dev: Number(stdDaily.toFixed(2)),
      lead_time_days: Number(leadTimeDays),
      review_period_days: Number(reviewPeriodDays),
      safety_stock: safetyStock,
      reorder_point: reorderPoint,
      reorder_recommendation: projectedGap > 0 ? Number(projectedGap.toFixed(2)) : 0,
      advisory_note:
        'Warehouse stock levels track quantity only. Min/max targets, safety stock, and reorder thresholds are advisory outputs and are not stored in the inventory schema.',
    });
  } catch (err) {
    console.error('❌ Safety stock calculation failed:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to calculate safety stock'));
  }
};

function bucketForecast(forecast = [], horizonDays = 84, bucketDays = 7) {
  const today = new Date();
  const buckets = [];
  const totalBuckets = Math.ceil(horizonDays / bucketDays);
  for (let i = 0; i < totalBuckets; i += 1) {
    const bucketStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i * bucketDays));
    const bucketEnd = new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth(), bucketStart.getUTCDate() + bucketDays));
    buckets.push({ index: i + 1, start: bucketStart.toISOString(), end: bucketEnd.toISOString(), demand: 0, receipts: 0 });
  }

  forecast.forEach(entry => {
    const demandDate = entry.date ? new Date(entry.date) : today;
    const dayOffset = Math.floor((demandDate - today) / (1000 * 60 * 60 * 24));
    if (dayOffset < 0) return;
    const bucketIndex = Math.min(Math.floor(dayOffset / bucketDays), buckets.length - 1);
    buckets[bucketIndex].demand += Number(entry.quantity) || 0;
  });

  return buckets;
}

function scheduleMrp(item) {
  const {
    item_name: itemName,
    forecast = [],
    on_hand: startingOnHand = 0,
    on_order: rawOnOrder = 0,
    safety_stock: safetyStock = 0,
    lead_time_days: leadTime = 14,
    lot_size: lotSize = 0,
    horizon_days: horizonDays = 84,
    bucket_days: bucketDays = 7,
    open_orders: openOrders = [],
  } = item;

  const buckets = bucketForecast(forecast, horizonDays, bucketDays);
  const plannedOrders = [];
  const scheduledReceipts = new Map();

  openOrders.forEach(order => {
    if (!order || !order.due_date) return;
    const due = new Date(order.due_date);
    const today = new Date();
    const dayOffset = Math.floor((due - today) / (1000 * 60 * 60 * 24));
    if (dayOffset < 0) return;
    const bucketIndex = Math.min(Math.floor(dayOffset / bucketDays), buckets.length - 1);
    scheduledReceipts.set(bucketIndex, (scheduledReceipts.get(bucketIndex) || 0) + (Number(order.quantity) || 0));
  });

  let projected = Number(startingOnHand) + Number(rawOnOrder || 0);

  buckets.forEach(bucket => {
    const receipts = scheduledReceipts.get(bucket.index - 1) || 0;
    bucket.receipts += receipts;
    projected += receipts;
    projected -= bucket.demand;

    if (projected < safetyStock) {
      const required = safetyStock - projected + bucket.demand;
      const orderQty = lotSize > 0 ? Math.ceil(required / lotSize) * lotSize : required;
      const needBy = new Date(bucket.start);
      const releaseDate = new Date(needBy);
      releaseDate.setUTCDate(needBy.getUTCDate() - Number(leadTime));

      plannedOrders.push({
        item_name: itemName,
        quantity: Number(orderQty.toFixed(2)),
        need_by: needBy.toISOString(),
        planned_release: releaseDate.toISOString(),
        bucket: bucket.index,
      });

      projected += orderQty;
    }

    bucket.projected_available = Number(projected.toFixed(2));
  });

  return { item_name: itemName, buckets, planned_orders: plannedOrders };
}

const runMrp = async (req, res, next) => {
  const { items = [], warehouse_id: warehouseId = null, horizon_days: providedHorizonDays, bucket_days: providedBucketDays } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return next(createHttpError(400, 'items array is required'));
  }

  try {
    const actor = await authority.actor(req.user);
    await inputScope(req, actor);
    const settings = await getPlanningSettings(warehouseId, actor);
    const horizonDays = providedHorizonDays ?? settings.mrp_horizon_days;
    const bucketDays = providedBucketDays ?? settings.mrp_bucket_days;
    positiveInteger(horizonDays, 'horizon_days');
    positiveInteger(bucketDays, 'bucket_days');
    for (const item of items) {
      if (item.department_id) await authority.department(actor, item.department_id);
      if (item.warehouse_id) await authority.warehouse(actor, item.warehouse_id);
      if (item.stock_item_id) await authority.stock(actor, item.stock_item_id, { warehouseId: item.warehouse_id || warehouseId, departmentId: item.department_id || actor.department_id });
    }
    const plans = items.map(item => scheduleMrp({ ...item, horizon_days: horizonDays, bucket_days: bucketDays }));
    const plannedOrders = plans.flatMap(plan => plan.planned_orders);

    res.json({
      horizon_days: Number(horizonDays),
      bucket_days: Number(bucketDays),
      summary: {
        total_items: plans.length,
        total_planned_orders: plannedOrders.length,
      },
      plans,
    });
  } catch (err) {
    console.error('❌ MRP run failed:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to run MRP/DRP netting'));
  }
};

const saveReplenishmentPolicy = async (req, res, next) => {
  try {
    const policy = await withTransaction(async client => {
      const actor = await authority.actor(req.user, 'replenish', client);
      const w = await authority.warehouse(actor, req.body.warehouse_id, client, true);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('planning-warehouse:'||$1::text,0))", [w.id]);
      await authority.stock(actor, req.body.stock_item_id, { warehouseId: w.id }, client);
      const before = (await client.query('SELECT * FROM warehouse_replenishment_policies WHERE warehouse_id=$1 AND stock_item_id=$2 FOR UPDATE', [w.id, req.body.stock_item_id])).rows[0] || null;
      const input = { reorder_point: 0, safety_stock: 0, lead_time_days: 14, review_period_days: 7, lot_size: 0, is_active: true, ...req.body };
      if (typeof input.is_active !== 'boolean') throw createHttpError(400, 'is_active must be a boolean');
      const { rows } = await client.query(`INSERT INTO warehouse_replenishment_policies(warehouse_id,stock_item_id,reorder_point,safety_stock,lead_time_days,review_period_days,lot_size,is_active,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(warehouse_id,stock_item_id) DO UPDATE SET
        reorder_point=EXCLUDED.reorder_point,safety_stock=EXCLUDED.safety_stock,lead_time_days=EXCLUDED.lead_time_days,
        review_period_days=EXCLUDED.review_period_days,lot_size=EXCLUDED.lot_size,is_active=EXCLUDED.is_active,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [w.id, req.body.stock_item_id, nonNegative(input.reorder_point,'reorder_point'), nonNegative(input.safety_stock,'safety_stock'),
        nonNegative(input.lead_time_days,'lead_time_days'), nonNegative(input.review_period_days,'review_period_days'), nonNegative(input.lot_size,'lot_size'), input.is_active, actor.id]);
      await audit(client, actor, 'warehouse_replenishment_policy', before, rows[0], 'planning.replenishment.policy.saved');
      return rows[0];
    });
    res.json({ policy });
  } catch (err) { next(err); }
};
const runReplenishmentPlanner = async (req, res, next) => {
  try {
    const result = await withTransaction(async client => {
      const actor = await authority.actor(req.user, 'replenish', client);
      const w = await authority.warehouse(actor, req.body.warehouse_id, client, true);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('planning-warehouse:'||$1::text,0))", [w.id]);
      const policies = (await client.query(`SELECT p.*,(SELECT COALESCE(SUM(s.quantity),0) FROM warehouse_stock_levels s WHERE s.warehouse_id=p.warehouse_id AND s.stock_item_id=p.stock_item_id) AS current_quantity FROM warehouse_replenishment_policies p WHERE p.warehouse_id=$1 AND p.is_active=true ORDER BY p.id FOR SHARE OF p`, [w.id])).rows;
      const tasks = [];
      for (const p of policies) {
        await authority.stock(actor, p.stock_item_id, { warehouseId: w.id }, client);
        if (Number(p.current_quantity) > Number(p.reorder_point)) continue;
        const existing = (await client.query("SELECT * FROM warehouse_replenishment_tasks WHERE warehouse_id=$1 AND stock_item_id=$2 AND status IN ('open','planned','ordered') ORDER BY id LIMIT 1 FOR UPDATE", [w.id, p.stock_item_id])).rows[0];
        if (existing) { tasks.push(existing); continue; }
        const required = Number(p.reorder_point)+Number(p.safety_stock)-Number(p.current_quantity);
        const quantity = Number(p.lot_size)>0 ? Math.ceil(required/Number(p.lot_size))*Number(p.lot_size) : required;
        const dueDate = new Date(); dueDate.setDate(dueDate.getDate()+Number(p.lead_time_days || 0));
        const task = (await client.query(`INSERT INTO warehouse_replenishment_tasks(warehouse_id,stock_item_id,current_quantity,reorder_point,safety_stock,suggested_quantity,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [w.id,p.stock_item_id,p.current_quantity,p.reorder_point,p.safety_stock,Number(quantity.toFixed(2)),dueDate.toISOString().slice(0,10),actor.id])).rows[0];
        await audit(client, actor, 'warehouse_replenishment_task', null, task, 'planning.replenishment.task.generated');
        tasks.push(task);
      }
      return { warehouse_id: w.id, tasks };
    });
    res.json(result);
  } catch (err) { next(err); }
};
const getPlanningDefaults = async (req,res,next) => {
  try {
    const actor = await authority.actor(req.user);
    const warehouseId = await inputScope(req, actor);
    res.json({ settings: await getPlanningSettings(warehouseId, actor) });
  } catch (err) { next(err); }
};
const savePlanningDefaults = async (req,res,next) => {
  try {
    const settings = await withTransaction(async client => {
      const actor = await authority.actor(req.user, 'manage', client);
      const warehouseId = req.body.warehouse_id == null ? null : (await authority.warehouse(actor, req.body.warehouse_id, client, true)).id;
      if (warehouseId == null && !(has(actor,'planning.cross-department') && has(actor,'planning.cross-warehouse')))
        throw createHttpError(403, 'Institute-wide defaults require institute-wide planning scope');
      await ensurePlanningSettingsTable(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('planning-defaults:'||$1::text||':'||COALESCE($2::text,'global'),0))", [actor.institute_id,warehouseId]);
      const before = (await client.query('SELECT * FROM planning_settings WHERE institute_id=$1 AND COALESCE(warehouse_id,-1)=COALESCE($2::bigint,-1) FOR UPDATE', [actor.institute_id,warehouseId])).rows[0] || null;
      const input = { ...DEFAULT_PLANNING_SETTINGS, ...req.body };
      const names = Object.keys(DEFAULT_PLANNING_SETTINGS);
      const values = names.map(name => {
        if (['safety_lead_time_days','safety_review_period_days'].includes(name)) {
          const n = nonNegative(input[name],name);
          if (!Number.isInteger(n) || n>3650) throw createHttpError(400, `${name} must be an integer no greater than 3650`);
          return n;
        }
        return positiveInteger(input[name], name, name.includes('months') ? 120 : 3650);
      });
      const row = (await client.query(`INSERT INTO planning_settings(institute_id,warehouse_id,forecast_horizon_months,forecast_window_size,safety_lead_time_days,safety_review_period_days,demand_history_days,demand_history_months,safety_history_days,mrp_horizon_days,mrp_bucket_days,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(institute_id,(COALESCE(warehouse_id,-1))) WHERE institute_id IS NOT NULL DO UPDATE SET
        forecast_horizon_months=EXCLUDED.forecast_horizon_months,forecast_window_size=EXCLUDED.forecast_window_size,safety_lead_time_days=EXCLUDED.safety_lead_time_days,safety_review_period_days=EXCLUDED.safety_review_period_days,demand_history_days=EXCLUDED.demand_history_days,demand_history_months=EXCLUDED.demand_history_months,safety_history_days=EXCLUDED.safety_history_days,mrp_horizon_days=EXCLUDED.mrp_horizon_days,mrp_bucket_days=EXCLUDED.mrp_bucket_days,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
        [actor.institute_id,warehouseId,...values,actor.id])).rows[0];
      await audit(client,actor,'planning_settings',before,row,'planning.defaults.saved'); return row;
    });
    res.json({ settings });
  } catch (err) { next(err); }
};
module.exports = { getDemandForecast, calculateSafetyStock, runMrp, getPlanningDefaults, savePlanningDefaults, saveReplenishmentPolicy, runReplenishmentPlanner };
