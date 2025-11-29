
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const DEFAULT_HISTORY_MONTHS = 12;

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

async function fetchMonthlyDemand(itemName, months = DEFAULT_HISTORY_MONTHS) {
  const { rows } = await pool.query(
    `SELECT TO_CHAR(r.created_at, 'YYYY-MM') AS bucket, COALESCE(SUM(ri.quantity), 0) AS quantity
     FROM requested_items ri
     JOIN requests r ON ri.request_id = r.id
     WHERE ri.item_name ILIKE $1
       AND r.created_at >= (CURRENT_DATE - ($2 || ' months')::INTERVAL)
     GROUP BY bucket
     ORDER BY bucket`,
    [itemName, months]
  );
  return rows.map(row => ({ bucket: row.bucket, quantity: Number(row.quantity) || 0 }));
}

async function fetchDailyDemand(itemName, days = 120) {
  const { rows } = await pool.query(
    `SELECT r.created_at::date AS bucket_date, COALESCE(SUM(ri.quantity), 0) AS quantity
     FROM requested_items ri
     JOIN requests r ON ri.request_id = r.id
     WHERE ri.item_name ILIKE $1
       AND r.created_at >= (CURRENT_DATE - ($2 || ' days')::INTERVAL)
     GROUP BY bucket_date
     ORDER BY bucket_date`,
    [itemName, days]
  );
  return rows.map(row => ({ day: row.bucket_date, quantity: Number(row.quantity) || 0 }));
}

const getDemandForecast = async (req, res, next) => {
  const { item_name: itemName, method = 'moving_average', horizon_months: horizonMonths = 6, window_size: windowSize = 3, sop_adjustments: sopAdjustments = [] } = req.body;

  if (!itemName) {
    return next(createHttpError(400, 'item_name is required'));
  }

  const horizon = Number(horizonMonths);
  if (Number.isNaN(horizon) || horizon <= 0) {
    return next(createHttpError(400, 'horizon_months must be a positive number'));
  }

  try {
    const history = await fetchMonthlyDemand(itemName, DEFAULT_HISTORY_MONTHS);
    let forecast;

    if (method === 'linear_trend') {
      forecast = linearTrend(history, horizon);
    } else {
      forecast = movingAverage(history, horizon, Number(windowSize) || 3);
    }

    const adjustedForecast = applySopAdjustments(forecast, sopAdjustments);

    res.json({
      item_name: itemName,
      method,
      horizon_months: horizon,
      history,
      forecast: adjustedForecast,
      assumptions: {
        window_size: Number(windowSize) || 3,
        sop_adjustments: sopAdjustments,
      },
    });
  } catch (err) {
    console.error('❌ Demand forecast failed:', err);
    next(createHttpError(500, 'Failed to generate demand forecast'));
  }
};

const calculateSafetyStock = async (req, res, next) => {
  const {
    item_name: itemName,
    service_level: rawServiceLevel = 0.95,
    lead_time_days: leadTimeDays = 14,
    review_period_days: reviewPeriodDays = 7,
    on_hand = 0,
    on_order = 0,
  } = req.body;

  if (!itemName) {
    return next(createHttpError(400, 'item_name is required'));
  }

  try {
    const dailyDemand = await fetchDailyDemand(itemName, 180);
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
    });
  } catch (err) {
    console.error('❌ Safety stock calculation failed:', err);
    next(createHttpError(500, 'Failed to calculate safety stock'));
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
  const { items = [], horizon_days: horizonDays = 84, bucket_days: bucketDays = 7 } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return next(createHttpError(400, 'items array is required'));
  }

  try {
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
    next(createHttpError(500, 'Failed to run MRP/DRP netting'));
  }
};

module.exports = { getDemandForecast, calculateSafetyStock, runMrp };