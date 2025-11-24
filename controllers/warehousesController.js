const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const requireWarehousePermission = user => {
  if (!user?.hasPermission('departments.manage')) {
    throw createHttpError(403, 'You do not have permission to manage warehouses');
  }
};

const listWarehouses = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, type, location, description, department_id, created_at, updated_at
         FROM warehouses
        ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to load warehouses:', err);
    next(createHttpError(500, 'Failed to load warehouses'));
  }
};

const createWarehouse = async (req, res, next) => {
  try {
    requireWarehousePermission(req.user);
  } catch (err) {
    return next(err);
  }

  const { name, location, description } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';

  if (!trimmedName) {
    return next(createHttpError(400, 'Warehouse name is required'));
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO warehouses (name, location, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, type, location, description, department_id, created_at, updated_at`,
      [trimmedName, location || null, description || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(createHttpError(409, 'A warehouse with this name already exists'));
    }
    console.error('❌ Failed to create warehouse:', err);
    next(createHttpError(500, 'Failed to create warehouse'));
  }
};

const updateWarehouse = async (req, res, next) => {
  try {
    requireWarehousePermission(req.user);
  } catch (err) {
    return next(err);
  }

  const warehouseId = Number(req.params.id);
  if (!Number.isInteger(warehouseId)) {
    return next(createHttpError(400, 'Invalid warehouse ID'));
  }

  const { name, location, description } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';

  if (!trimmedName) {
    return next(createHttpError(400, 'Warehouse name is required'));
  }

  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE warehouses
          SET name = $1,
              location = $2,
              description = $3,
              updated_at = NOW()
        WHERE id = $4
        RETURNING id, name, type, location, description, department_id, created_at, updated_at`,
      [trimmedName, location || null, description || null, warehouseId]
    );

    if (rowCount === 0) {
      return next(createHttpError(404, 'Warehouse not found'));
    }

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(createHttpError(409, 'A warehouse with this name already exists'));
    }
    console.error('❌ Failed to update warehouse:', err);
    next(createHttpError(500, 'Failed to update warehouse'));
  }
};

module.exports = { listWarehouses, createWarehouse, updateWarehouse };