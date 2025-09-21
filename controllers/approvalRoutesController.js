const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const ADMIN_ROLES = ['admin', 'SCM'];

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
  const { role: actingRole } = req.user;
  if (!ADMIN_ROLES.includes(actingRole)) {
    return next(createHttpError(403, 'Only Admin or SCM can modify routes'));
  }

  const { request_type, department_type, approval_level, role, min_amount, max_amount } = req.body;
  if (!request_type || !department_type || !approval_level || !role) {
    return next(createHttpError(400, 'Missing required fields'));
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO approval_routes (request_type, department_type, approval_level, role, min_amount, max_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [request_type, department_type, approval_level, role, min_amount, max_amount]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create approval route:', err);
    next(createHttpError(500, 'Failed to create approval route'));
  }
};

const updateRoute = async (req, res, next) => {
  const { role: actingRole } = req.user;
  if (!ADMIN_ROLES.includes(actingRole)) {
    return next(createHttpError(403, 'Only Admin or SCM can modify routes'));
  }
  const { id } = req.params;
  const { request_type, department_type, approval_level, role, min_amount, max_amount } = req.body;

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
      [request_type, department_type, approval_level, role, min_amount, max_amount, id]
    );

    if (rows.length === 0) return next(createHttpError(404, 'Route not found'));
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update approval route:', err);
    next(createHttpError(500, 'Failed to update approval route'));
  }
};

const deleteRoute = async (req, res, next) => {
  const { role: actingRole } = req.user;
  if (!ADMIN_ROLES.includes(actingRole)) {
    return next(createHttpError(403, 'Only Admin or SCM can modify routes'));
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