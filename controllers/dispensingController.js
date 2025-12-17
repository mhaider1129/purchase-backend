const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureMonthlyDispensingTables = require('../utils/ensureMonthlyDispensingTables');

const normalizeMonth = (month) => {
  if (!month) return null;
  const trimmed = month.toString().trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const [_, yearStr, monthStr] = match; // eslint-disable-line no-unused-vars
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return new Date(Date.UTC(year, monthIndex, 1));
};

const importMonthlyDispensing = async (req, res, next) => {
  const { rows } = req.body;
  const userId = req.user?.id;

  if (!req.user?.hasPermission('warehouse.manage-supply') && !req.user?.hasPermission('dashboard.view')) {
    return next(createHttpError(403, 'You do not have permission to record dispensing data'));
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return next(createHttpError(400, 'rows array is required'));
  }

  const normalizedRows = rows.map((row, index) => {
    const monthDate = normalizeMonth(row.month);
    if (!monthDate) {
      throw createHttpError(400, `Row ${index + 1}: month must be in YYYY-MM format`);
    }

    const itemName = row.itemName?.toString().trim();
    if (!itemName) {
      throw createHttpError(400, `Row ${index + 1}: itemName is required`);
    }

    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw createHttpError(400, `Row ${index + 1}: quantity must be a non-negative number`);
    }

    const unit = row.unit?.toString().trim() || null;
    const facility = row.facility?.toString().trim() || row.facility_name?.toString().trim() || null;
    const notes = row.notes?.toString().trim() || null;

    return { monthDate, itemName, quantity, unit, facility, notes };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureMonthlyDispensingTables(client);

    const values = normalizedRows.map((row) => [
      row.monthDate,
      row.itemName,
      row.quantity,
      row.unit,
      row.facility,
      row.notes,
      userId ?? null,
    ]);

    for (const params of values) {
      await client.query(
        `INSERT INTO monthly_dispensing (
          month_start, item_name, quantity, unit, facility_name, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (month_start, item_name, COALESCE(facility_name, ''))
        DO UPDATE SET
          quantity = EXCLUDED.quantity,
          unit = COALESCE(EXCLUDED.unit, monthly_dispensing.unit),
          notes = COALESCE(EXCLUDED.notes, monthly_dispensing.notes),
          facility_name = EXCLUDED.facility_name,
          created_by = EXCLUDED.created_by,
          created_at = CURRENT_TIMESTAMP`,
        params,
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, inserted: values.length });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const getMonthlyDispensing = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission('warehouse.manage-supply') && !req.user?.hasPermission('dashboard.view')) {
      return next(createHttpError(403, 'You do not have permission to view dispensing data'));
    }

    await ensureMonthlyDispensingTables();
    const { rows } = await pool.query(
      `SELECT id, month_start, item_name, quantity, unit, facility_name, notes, created_at
         FROM monthly_dispensing
        ORDER BY month_start DESC, item_name ASC
        LIMIT 200`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

const getMonthlyAnalytics = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission('warehouse.manage-supply') && !req.user?.hasPermission('dashboard.view')) {
      return next(createHttpError(403, 'You do not have permission to view dispensing analytics'));
    }

    await ensureMonthlyDispensingTables();

    const monthlyTotalsPromise = pool.query(
      `SELECT to_char(month_start, 'YYYY-MM') AS month,
              SUM(quantity) AS total_quantity
         FROM monthly_dispensing
        GROUP BY month_start
        ORDER BY month_start ASC`,
    );

    const topItemsPromise = pool.query(
      `SELECT item_name, SUM(quantity) AS total_quantity
         FROM monthly_dispensing
        GROUP BY item_name
        ORDER BY SUM(quantity) DESC
        LIMIT 8`,
    );

    const facilityBreakdownPromise = pool.query(
      `SELECT COALESCE(facility_name, 'Unspecified') AS facility,
              SUM(quantity) AS total_quantity
         FROM monthly_dispensing
        GROUP BY facility
        ORDER BY total_quantity DESC`,
    );

    const [monthlyTotalsRes, topItemsRes, facilityBreakdownRes] = await Promise.all([
      monthlyTotalsPromise,
      topItemsPromise,
      facilityBreakdownPromise,
    ]);

    res.json({
      monthlyTotals: monthlyTotalsRes.rows,
      topItems: topItemsRes.rows,
      facilityBreakdown: facilityBreakdownRes.rows,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  importMonthlyDispensing,
  getMonthlyDispensing,
  getMonthlyAnalytics,
};